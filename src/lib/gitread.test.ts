/**
 * The mirror read transport.
 *
 * Four things carry real risk here and are what this covers: that a read grant
 * is proved by a read and that a rate limit never reads as a bad token; that a
 * truncated tree stops the sync loudly instead of quietly syncing a library
 * with holes in it; that blobs come back as UTF-8 rather than as bytes read
 * one code point at a time; and that a 5xx is retried while a 4xx is not,
 * because retrying an answer only spends the rate limit to hear it again.
 *
 * And one thing that is not a behaviour but a fence: no request this module
 * can make is a write.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitHubError } from './github';
import {
  NEWSLETTERS,
  getBlob,
  getHeadSha,
  getTree,
  selectStale,
  verifyReadAccess,
} from './gitread';

const TOKEN = 'test-token-not-a-real-pat';
const REPO_BASE = `https://api.github.com/repos/${NEWSLETTERS.owner}/${NEWSLETTERS.repo}`;

interface Call {
  method: string;
  url: string;
}

let calls: Call[] = [];

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Answers in order; the last answer repeats if more calls arrive. */
function serve(answers: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  calls = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init: { method?: string } = {}) => {
    calls.push({ method: init.method ?? 'GET', url: String(url) });
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    const status = answer.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => answer.headers?.[name.toLowerCase()] ?? null },
      json: () => Promise.resolve(answer.body ?? {}),
    } as unknown as Response);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  calls = [];
});

describe('verifying read access', () => {
  it('is proved by a read that returns the repo', async () => {
    serve([{ body: { full_name: `${NEWSLETTERS.owner}/${NEWSLETTERS.repo}` } }]);

    await expect(verifyReadAccess(TOKEN, NEWSLETTERS)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ method: 'GET', url: REPO_BASE }]);
  });

  it('reads a private repo it cannot see (404) as no access', async () => {
    serve([{ status: 404 }]);
    const result = await verifyReadAccess(TOKEN, NEWSLETTERS);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('cannot read that repo');
  });

  it('reads a refusal (403) as no access', async () => {
    serve([{ status: 403 }]);
    const result = await verifyReadAccess(TOKEN, NEWSLETTERS);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('cannot read that repo');
  });

  it('never blames the token for a rate limit', async () => {
    serve([{ status: 403, headers: { 'x-ratelimit-remaining': '0' } }]);

    const result = await verifyReadAccess(TOKEN, NEWSLETTERS);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('the token is fine');
  });

  it('says it could not check rather than claiming no access, when offline', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('failed to fetch')));

    const result = await verifyReadAccess(TOKEN, NEWSLETTERS);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('could not reach github');
  });
});

describe('the head check', () => {
  it('asks the default branch for its commit', async () => {
    serve([{ body: { commit: { sha: 'abc123' } } }]);

    await expect(getHeadSha(TOKEN, NEWSLETTERS)).resolves.toBe('abc123');
    expect(calls[0].url).toBe(`${REPO_BASE}/branches/${NEWSLETTERS.branch}`);
  });

  it('refuses a body with no sha in it rather than returning an empty one', async () => {
    serve([{ body: { commit: {} } }]);
    await expect(getHeadSha(TOKEN, NEWSLETTERS)).rejects.toBeInstanceOf(GitHubError);
  });
});

describe('the tree', () => {
  it('returns the files, and only the files', async () => {
    serve([
      {
        body: {
          truncated: false,
          tree: [
            { path: 'state', type: 'tree', sha: 'dir' },
            { path: 'state/gists.md', type: 'blob', sha: 'g1', size: 120 },
            { path: 'state/tape.json', type: 'blob', sha: 't1', size: 24 },
            { path: 'broken', type: 'blob' },
          ],
        },
      },
    ]);

    await expect(getTree(TOKEN, NEWSLETTERS, 'head')).resolves.toEqual([
      { path: 'state/gists.md', sha: 'g1', size: 120 },
      { path: 'state/tape.json', sha: 't1', size: 24 },
    ]);
  });

  it('refuses a truncated tree, and says why in a sentence the owner can read', async () => {
    serve([{ body: { truncated: true, tree: [] } }]);

    await expect(getTree(TOKEN, NEWSLETTERS, 'head')).rejects.toThrow(/missing files/);
  });
});

describe('blobs', () => {
  it('decodes as UTF-8, not as one byte per character', async () => {
    const prose = 'term premium — Zürich, ¥100bn, “the long end” … 🜚';
    serve([{ body: { encoding: 'base64', content: encode(prose) } }]);

    await expect(getBlob(TOKEN, NEWSLETTERS, 'sha')).resolves.toBe(prose);
  });

  it('accepts the wrapped base64 the API actually sends', async () => {
    const prose = 'a line of prose with an em dash — and an accent, café.';
    const wrapped = encode(prose).replace(/(.{8})/g, '$1\n');
    serve([{ body: { encoding: 'base64', content: wrapped } }]);

    await expect(getBlob(TOKEN, NEWSLETTERS, 'sha')).resolves.toBe(prose);
  });

  it('refuses a body it cannot decode rather than returning something wrong', async () => {
    serve([{ body: { encoding: 'none', content: '' } }]);
    await expect(getBlob(TOKEN, NEWSLETTERS, 'sha')).rejects.toThrow(/cannot decode/);
  });
});

describe('retrying', () => {
  it('retries a 5xx and takes the answer when it arrives', async () => {
    serve([{ status: 500 }, { status: 502 }, { body: { commit: { sha: 'late' } } }]);

    await expect(getHeadSha(TOKEN, NEWSLETTERS)).resolves.toBe('late');
    expect(calls).toHaveLength(3);
  });

  it('gives up after three attempts rather than hammering', async () => {
    serve([{ status: 500 }]);

    await expect(getHeadSha(TOKEN, NEWSLETTERS)).rejects.toBeInstanceOf(GitHubError);
    expect(calls).toHaveLength(3);
  });

  it('does not retry an answer', async () => {
    serve([{ status: 404 }]);

    await expect(getHeadSha(TOKEN, NEWSLETTERS)).rejects.toBeInstanceOf(GitHubError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry being offline — three 30s aborts is a hung pane', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', () => {
      attempts += 1;
      return Promise.reject(new TypeError('failed to fetch'));
    });

    await expect(getHeadSha(TOKEN, NEWSLETTERS)).rejects.toMatchObject({ kind: 'network' });
    expect(attempts).toBe(1);
  });
});

describe('the read-only fence', () => {
  it('makes no request that is not a GET', async () => {
    serve([
      { body: { commit: { sha: 'h' } } },
      { body: { truncated: false, tree: [{ path: 'a', type: 'blob', sha: 's', size: 1 }] } },
      { body: { encoding: 'base64', content: encode('x') } },
      { body: {} },
    ]);

    await getHeadSha(TOKEN, NEWSLETTERS);
    await getTree(TOKEN, NEWSLETTERS, 'h');
    await getBlob(TOKEN, NEWSLETTERS, 's');
    await verifyReadAccess(TOKEN, NEWSLETTERS);

    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });
});

describe('the sha diff', () => {
  const file = (path: string, sha: string) => ({ path, sha, size: 1 });
  const wanted = [file('state/gists.md', 'g2'), file('state/tape.json', 't1')];

  it('takes what is missing and what has moved, and nothing else', () => {
    const cached = new Map([
      ['state/gists.md', 'g1'],
      ['state/tape.json', 't1'],
    ]);

    expect(selectStale(wanted, cached).map(entry => entry.path)).toEqual(['state/gists.md']);
  });

  it('takes everything when nothing is cached', () => {
    expect(selectStale(wanted, new Map())).toHaveLength(2);
  });

  it('takes nothing when every sha already matches', () => {
    const cached = new Map([
      ['state/gists.md', 'g2'],
      ['state/tape.json', 't1'],
    ]);

    expect(selectStale(wanted, cached)).toEqual([]);
  });
});
