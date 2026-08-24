import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GITHUB_API_BASE,
  GITHUB_OWNER,
  GITHUB_REPO,
  GitHubError,
  PUSH_LOCK_NAME,
  REQUEST_TIMEOUT_MS,
  appendLines,
  getFile,
  isJournalDeviceId,
  listJournal,
  onPushFailure,
  putFile,
  verifyAccess,
} from './github';
import type { PushFailure } from './github';

const TOKEN = 'test-token-not-a-real-pat';
const PATH = 'journal/2026-08.laptop.jsonl';
const REPO_BASE = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

/** Longer than every backoff the module can schedule between append attempts. */
const RETRY_WINDOW_MS = 5_000;

// ============================================================================
// UTF-8 base64 helpers (mirror of the module's, so the fake speaks the same wire format)
// ============================================================================

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(data: string): string {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ============================================================================
// Fake GitHub contents API — stateful, never touches the network
// ============================================================================

interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** A response forced onto the next request: a bare status, or the full shape. */
type Forced =
  | number
  | { status: number; headers?: Record<string, string>; body?: unknown; unreadable?: boolean };

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  unreadable = false,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => {
      if (unreadable) throw new SyntaxError('Unexpected end of JSON input');
      return body;
    },
  } as unknown as Response;
}

function forcedResponse(forced: Forced): Response {
  const spec = typeof forced === 'number' ? { status: forced } : forced;
  return response(
    spec.status,
    'body' in spec && spec.body !== undefined ? spec.body : { message: 'forced' },
    'headers' in spec ? spec.headers : {},
    'unreadable' in spec && spec.unreadable === true,
  );
}

function fakeGitHub(
  options: {
    files?: Record<string, string>;
    listing?: unknown[] | null;
  } = {},
) {
  const files = new Map<string, { text: string; sha: string }>();
  let shaCount = 0;
  const nextSha = () => {
    shaCount += 1;
    return `sha${shaCount}`;
  };
  for (const [path, text] of Object.entries(options.files ?? {})) {
    files.set(path, { text, sha: nextSha() });
  }

  const control = {
    calls: [] as RecordedCall[],
    log: [] as string[],
    pending: [] as Array<() => void>,
    holding: false,
    /** responses forced on the next PUTs, one shift per PUT */
    failPuts: [] as Forced[],
    /** responses forced on the next GETs, one shift per GET */
    failGets: [] as Forced[],
    /** a competing writer's line, landed whenever a forced PUT failure fires */
    foreignLine: null as string | null,
    text: (path: string) => files.get(path)?.text,
    sha: (path: string) => files.get(path)?.sha,
    methods: () => control.calls.map((call) => call.method),
    puts: () => control.calls.filter((call) => call.method === 'PUT'),
  };

  function append(path: string, line: string): void {
    const current = files.get(path);
    const base = current === undefined ? '' : current.text;
    const joined = base.length === 0 || base.endsWith('\n') ? `${base}${line}\n` : `${base}\n${line}\n`;
    files.set(path, { text: joined, sha: nextSha() });
  }

  function respond(method: string, path: string, body: Record<string, unknown> | null): Response {
    const forced = (method === 'PUT' ? control.failPuts : control.failGets).shift();
    if (forced !== undefined) {
      if (method === 'PUT' && control.foreignLine !== null) append(path, control.foreignLine);
      return forcedResponse(forced);
    }

    if (path === '') return response(200, { full_name: `${GITHUB_OWNER}/${GITHUB_REPO}` });

    if (path === 'journal' && method === 'GET') {
      const listing = options.listing ?? null;
      if (listing === null) return response(404, { message: 'Not Found' });
      return response(200, listing);
    }

    if (method === 'GET') {
      const file = files.get(path);
      if (file === undefined) return response(404, { message: 'Not Found' });
      return response(200, { content: encode(file.text), encoding: 'base64', sha: file.sha });
    }

    if (method === 'PUT') {
      const current = files.get(path);
      const sentSha = typeof body?.sha === 'string' ? body.sha : null;
      const currentSha = current === undefined ? null : current.sha;
      if (sentSha !== currentSha) return response(409, { message: 'sha mismatch' });
      const sha = nextSha();
      files.set(path, { text: decode(String(body?.content ?? '')), sha });
      return response(200, { content: { sha } });
    }

    return response(405, { message: 'not implemented' });
  }

  const handler = async (input: string, init?: FetchInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const suffix = input.slice(REPO_BASE.length);
    const path = suffix.startsWith('/contents/')
      ? decodeURIComponent(suffix.slice('/contents/'.length))
      : '';
    const body = init?.body === undefined ? null : (JSON.parse(init.body) as Record<string, unknown>);
    control.calls.push({ method, path, headers: init?.headers ?? {}, body });
    control.log.push(`${method} start`);
    if (control.holding) {
      // Held until the test releases it — or until the module's own timeout aborts it.
      await new Promise<void>((resolve, reject) => {
        control.pending.push(resolve);
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    control.log.push(`${method} end`);
    return respond(method, path, body);
  };

  vi.stubGlobal('fetch', vi.fn(handler));
  return control;
}

type FakeGitHub = ReturnType<typeof fakeGitHub>;

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Drains the microtask queue without letting any timer fire. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

/** Lets exactly one in-flight request finish, waiting for one to exist first. */
async function releaseNext(github: FakeGitHub): Promise<void> {
  for (let i = 0; i < 100 && github.pending.length === 0; i += 1) await tick();
  const next = github.pending.shift();
  if (next === undefined) throw new Error('no request was in flight');
  next();
  await tick();
}

/** Watchers registered by a test, dropped again however the test ends. */
const watching: (() => void)[] = [];

function watchPushFailures(listener: (failure: PushFailure) => void): PushFailure[] {
  const seen: PushFailure[] = [];
  watching.push(
    onPushFailure((failure) => {
      seen.push(failure);
      listener(failure);
    }),
  );
  return seen;
}

afterEach(() => {
  for (const unwatch of watching) unwatch();
  watching.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'locks');
});

// ============================================================================
// Tests
// ============================================================================

describe('verifyAccess', () => {
  /**
   * Written out rather than imported: the probe's whole safety rests on this
   * exact sha reaching GitHub, so the test must fail if the module changes it.
   */
  const PROBE_SHA = '0000000000000000000000000000000000000000';
  const PROBE_PATH = 'journal/.gitkeep';

  /** Nothing verifyAccess sends may be capable of writing: every PUT carries the sentinel. */
  function expectNothingCouldWrite(github: FakeGitHub): void {
    for (const put of github.puts()) {
      expect(put.path).toBe(PROBE_PATH);
      expect(put.body?.sha).toBe(PROBE_SHA);
    }
  }

  it('confirms write access from a conflicting probe, and sends the documented auth headers', async () => {
    const github = fakeGitHub({ files: { [PROBE_PATH]: '' } });

    expect(await verifyAccess(TOKEN)).toEqual({ ok: true });

    expect(github.calls[0].headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('probes journal/.gitkeep with a sha that cannot match, and leaves it untouched', async () => {
    const github = fakeGitHub({ files: { [PROBE_PATH]: '' } });
    const before = github.sha(PROBE_PATH);

    expect(await verifyAccess(TOKEN)).toEqual({ ok: true });

    expect(github.methods()).toEqual(['GET', 'PUT']);
    expect(github.puts()).toHaveLength(1);
    expect(github.puts()[0].path).toBe(PROBE_PATH);
    expect(github.puts()[0].body?.sha).toBe(PROBE_SHA);
    // The write loses its own conflict check, so the file cannot have moved.
    expect(github.text(PROBE_PATH)).toBe('');
    expect(github.sha(PROBE_PATH)).toBe(before);
  });

  it('rejects a token the probe may not write with, and names the permission', async () => {
    const github = fakeGitHub({ files: { [PROBE_PATH]: '' } });
    github.failPuts.push(403);

    const result = await verifyAccess(TOKEN);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('read-only');
    expect(result.reason).toContain('contents read and write');
    expect(result.reason).not.toContain(TOKEN);
    expectNothingCouldWrite(github);
  });

  it('does not blame the token when the probe is rate limited', async () => {
    const github = fakeGitHub({ files: { [PROBE_PATH]: '' } });

    github.failPuts.push({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    const spent = await verifyAccess(TOKEN);
    expect(spent.ok).toBe(false);
    expect(spent.reason).toContain('rate limit');
    expect(spent.reason).not.toContain('read-only');

    github.failPuts.push(429);
    const throttled = await verifyAccess(TOKEN);
    expect(throttled.ok).toBe(false);
    expect(throttled.reason).toContain('rate limit');
    expect(throttled.reason).not.toContain('read-only');
  });

  it('will not confirm write access from a status that is neither 409 nor 403', async () => {
    const github = fakeGitHub({ files: { [PROBE_PATH]: '' } });

    github.failPuts.push(422);
    const unprocessable = await verifyAccess(TOKEN);
    expect(unprocessable.ok).toBe(false);
    expect(unprocessable.reason).toContain('could not confirm write access');

    github.failPuts.push(500);
    const broken = await verifyAccess(TOKEN);
    expect(broken.ok).toBe(false);
    expect(broken.reason).toContain('could not confirm write access');

    expectNothingCouldWrite(github);
  });

  it('will not confirm write access, or create the file, when the probe target is gone', async () => {
    const github = fakeGitHub();
    github.failPuts.push(404);

    const result = await verifyAccess(TOKEN);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('could not confirm write access');
    expect(result.reason).toContain(PROBE_PATH);
    // A missing probe target is never answered by creating one.
    expect(github.puts()).toHaveLength(1);
    expectNothingCouldWrite(github);
    expect(github.text(PROBE_PATH)).toBeUndefined();
  });

  it('reports a rejected token on 401 and on a 403 that is not a rate limit', async () => {
    const github = fakeGitHub();
    const rejected = `github rejected the token — it needs contents read and write on ${GITHUB_OWNER}/${GITHUB_REPO}`;

    github.failGets.push(401);
    expect(await verifyAccess(TOKEN)).toEqual({ ok: false, reason: rejected });

    github.failGets.push({ status: 403, headers: { 'x-ratelimit-remaining': '4999' } });
    expect(await verifyAccess(TOKEN)).toEqual({ ok: false, reason: rejected });
  });

  it('does not blame the token for a rate limit', async () => {
    const github = fakeGitHub();

    github.failGets.push({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    const spent = await verifyAccess(TOKEN);
    expect(spent.ok).toBe(false);
    expect(spent.reason).not.toContain('rejected the token');
    expect(spent.reason).toContain('rate limit');

    github.failGets.push(429);
    const throttled = await verifyAccess(TOKEN);
    expect(throttled.ok).toBe(false);
    expect(throttled.reason).not.toContain('rejected the token');
    expect(throttled.reason).toContain('rate limit');
  });

  it('separates an invisible repo from an unreachable GitHub', async () => {
    const github = fakeGitHub();
    github.failGets.push(404);
    expect(await verifyAccess(TOKEN)).toEqual({
      ok: false,
      reason: `${GITHUB_OWNER}/${GITHUB_REPO} is not visible to this token`,
    });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const offline = await verifyAccess(TOKEN);
    expect(offline.ok).toBe(false);
    expect(offline.reason).toContain('could not reach github');
    expect(offline.reason).not.toContain(TOKEN);
  });
});

describe('isJournalDeviceId', () => {
  it('accepts what db.ts mints and refuses everything else', () => {
    expect(isJournalDeviceId('a1b2c3d4')).toBe(true);
    expect(isJournalDeviceId('00000000')).toBe(true);
    expect(isJournalDeviceId('ffffffff')).toBe(true);

    // A dot makes a four-part file name; a slash makes a subdirectory. Both
    // are written happily and read by nothing.
    expect(isJournalDeviceId('my.phone')).toBe(false);
    expect(isJournalDeviceId('a/b12345')).toBe(false);
    // Right shape, wrong alphabet or wrong length.
    expect(isJournalDeviceId('A1B2C3D4')).toBe(false);
    expect(isJournalDeviceId('phone-01')).toBe(false);
    expect(isJournalDeviceId('a1b2c3dg')).toBe(false);
    expect(isJournalDeviceId('a1b2c3d')).toBe(false);
    expect(isJournalDeviceId('a1b2c3d45')).toBe(false);
    expect(isJournalDeviceId('a1b2c3d ')).toBe(false);
    expect(isJournalDeviceId('')).toBe(false);
  });

  it('refuses exactly the ids whose journal file the listing cannot see', async () => {
    fakeGitHub({
      listing: [
        { type: 'file', name: '2026-08.my.phone.jsonl', path: 'journal/2026-08.my.phone.jsonl', sha: 'sha-a' },
        { type: 'file', name: '2026-08.a1b2c3d4.jsonl', path: 'journal/2026-08.a1b2c3d4.jsonl', sha: 'sha-b' },
      ],
    });

    const listed = await listJournal(TOKEN);

    // The dotted file exists on the remote and is simply never read: written,
    // looks backed up, invisible to a cold restore. That is what the guard is
    // for, and it agrees with the listing exactly.
    expect(listed.map((file) => file.device)).toEqual(['a1b2c3d4']);
    expect(isJournalDeviceId('my.phone')).toBe(false);
    expect(isJournalDeviceId('a1b2c3d4')).toBe(true);
  });
});

describe('push failure watchers', () => {
  it('reports the kind of a failed push at the moment it fails', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'first\n' } });
    const seen = watchPushFailures(() => undefined);

    github.failPuts.push(401);
    await expect(appendLines(TOKEN, PATH, ['second'])).rejects.toBeInstanceOf(GitHubError);

    expect(seen).toEqual([{ kind: 'auth', retryAfterMs: null }]);
  });

  it('passes on the wait GitHub asked for', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'first\n' } });
    const seen = watchPushFailures(() => undefined);

    github.failPuts.push({ status: 429, headers: { 'retry-after': '120' } });
    await expect(appendLines(TOKEN, PATH, ['second'])).rejects.toBeInstanceOf(GitHubError);

    expect(seen).toEqual([{ kind: 'ratelimit', retryAfterMs: 120_000 }]);
  });

  it('says nothing when the push lands, and stops when unwatched', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'first\n' } });
    const seen = watchPushFailures(() => undefined);

    await appendLines(TOKEN, PATH, ['second']);
    expect(seen).toEqual([]);

    for (const unwatch of watching) unwatch();
    watching.length = 0;
    github.failPuts.push(500);
    await expect(appendLines(TOKEN, PATH, ['third'])).rejects.toBeInstanceOf(GitHubError);
    expect(seen).toEqual([]);
  });

  it('lets the caller see the rejection even when a watcher throws', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'first\n' } });
    const seen = watchPushFailures(() => {
      throw new Error('a watcher fell over');
    });

    github.failPuts.push(500);
    await expect(appendLines(TOKEN, PATH, ['second'])).rejects.toBeInstanceOf(GitHubError);

    expect(seen).toEqual([{ kind: 'http', retryAfterMs: null }]);
  });
});

describe('error classification', () => {
  it.each([
    { label: '403 with the rate-limit budget spent', forced: { status: 403, headers: { 'x-ratelimit-remaining': '0' } }, kind: 'ratelimit' },
    { label: '403 with budget still left', forced: { status: 403, headers: { 'x-ratelimit-remaining': '4999' } }, kind: 'auth' },
    { label: '403 with no rate-limit header at all', forced: { status: 403 }, kind: 'auth' },
    { label: '429', forced: { status: 429 }, kind: 'ratelimit' },
  ])('classifies a $label as $kind', async ({ forced, kind }) => {
    const github = fakeGitHub({ files: { [PATH]: 'line\n' } });
    github.failGets.push(forced);

    const error = await getFile(TOKEN, PATH).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe(kind);
    expect((error as GitHubError).message).not.toContain(TOKEN);
  });

  it('carries the wait GitHub asked for, from retry-after or x-ratelimit-reset', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'line\n' } });

    github.failGets.push({ status: 429, headers: { 'retry-after': '12' } });
    const seconds = (await getFile(TOKEN, PATH).catch((caught: unknown) => caught)) as GitHubError;
    expect(seconds.retryAfterMs).toBe(12_000);

    const reset = Math.floor(Date.now() / 1000) + 30;
    github.failGets.push({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });
    const epoch = (await getFile(TOKEN, PATH).catch((caught: unknown) => caught)) as GitHubError;
    expect(epoch.retryAfterMs).toBeGreaterThan(28_000);
    expect(epoch.retryAfterMs).toBeLessThanOrEqual(30_000);
  });
});

describe('listJournal', () => {
  it('returns one entry per YYYY-MM.<device>.jsonl and ignores everything else', async () => {
    fakeGitHub({
      listing: [
        { name: '.gitkeep', path: 'journal/.gitkeep', sha: 'k0', type: 'file' },
        { name: '2026-07.laptop.jsonl', path: 'journal/2026-07.laptop.jsonl', sha: 'a1', type: 'file' },
        { name: '2026-08.laptop.jsonl', path: 'journal/2026-08.laptop.jsonl', sha: 'a2', type: 'file' },
        { name: '2026-08.phone.jsonl', path: 'journal/2026-08.phone.jsonl', sha: 'a3', type: 'file' },
        { name: '2026-08.seed.jsonl.bak', path: 'journal/2026-08.seed.jsonl.bak', sha: 'a4', type: 'file' },
        { name: 'notes.md', path: 'journal/notes.md', sha: 'a5', type: 'file' },
        { name: '2026-08.laptop.json', path: 'journal/2026-08.laptop.json', sha: 'a7', type: 'file' },
        { name: '2026-08.laptop.jsonl', path: 'journal/archive', sha: 'a6', type: 'dir' },
      ],
    });

    const files = await listJournal(TOKEN);

    expect(files).toEqual([
      { path: 'journal/2026-07.laptop.jsonl', name: '2026-07.laptop.jsonl', sha: 'a1', device: 'laptop', month: '2026-07' },
      { path: 'journal/2026-08.laptop.jsonl', name: '2026-08.laptop.jsonl', sha: 'a2', device: 'laptop', month: '2026-08' },
      { path: 'journal/2026-08.phone.jsonl', name: '2026-08.phone.jsonl', sha: 'a3', device: 'phone', month: '2026-08' },
    ]);
  });

  it('returns [] when the journal directory does not exist yet', async () => {
    fakeGitHub({ listing: null });
    expect(await listJournal(TOKEN)).toEqual([]);
  });

  it('returns [] when a GET is answered 409 because the repository is still empty', async () => {
    const github = fakeGitHub({ listing: null });
    github.failGets.push(409);
    expect(await listJournal(TOKEN)).toEqual([]);
  });

  it('throws instead of reporting an empty remote when the body is not a list', async () => {
    const github = fakeGitHub({ listing: null });
    github.failGets.push({ status: 200, body: { message: 'not a list' } });

    const error = await listJournal(TOKEN).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('http');
    expect((error as GitHubError).status).toBeGreaterThanOrEqual(400);
  });
});

describe('getFile', () => {
  it('returns null on 404 instead of throwing', async () => {
    fakeGitHub();
    expect(await getFile(TOKEN, PATH)).toBeNull();
  });

  it('returns null when a GET is answered 409 because the repository is still empty', async () => {
    const github = fakeGitHub();
    github.failGets.push(409);
    expect(await getFile(TOKEN, PATH)).toBeNull();
  });

  it('surfaces 401 as an auth error, distinguishable from a 500', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'line\n' } });

    github.failGets.push(401);
    const unauthorized = await getFile(TOKEN, PATH).catch((error: unknown) => error);
    expect(unauthorized).toBeInstanceOf(GitHubError);
    expect((unauthorized as GitHubError).kind).toBe('auth');
    expect((unauthorized as GitHubError).status).toBe(401);
    expect((unauthorized as GitHubError).message).not.toContain(TOKEN);

    github.failGets.push(500);
    const serverError = await getFile(TOKEN, PATH).catch((error: unknown) => error);
    expect(serverError).toBeInstanceOf(GitHubError);
    expect((serverError as GitHubError).kind).toBe('http');
    expect((serverError as GitHubError).status).toBe(500);
  });

  it('surfaces a fetch failure as a network error carrying no token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await getFile(TOKEN, PATH).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('network');
    expect((error as GitHubError).message).not.toContain(TOKEN);
  });

  it('types an unreadable body instead of leaking a SyntaxError', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'line\n' } });
    github.failGets.push({ status: 200, unreadable: true });

    const error = await getFile(TOKEN, PATH).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('http');
    expect((error as GitHubError).status).toBeGreaterThanOrEqual(400);
  });

  it('refuses a file it cannot decode, with a status that reads as a failure', async () => {
    const github = fakeGitHub();
    // What the contents API sends for a file over 1 MB.
    github.failGets.push({ status: 200, body: { encoding: 'none', content: '', sha: 'big' } });

    const error = await getFile(TOKEN, PATH).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('http');
    expect((error as GitHubError).status).toBeGreaterThanOrEqual(400);
  });

  it('throws rather than handing back an empty sha the next write would treat as create', async () => {
    const github = fakeGitHub();
    github.failGets.push({ status: 200, body: { encoding: 'base64', content: encode('line\n') } });

    const error = await getFile(TOKEN, PATH).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('http');
    expect((error as GitHubError).status).toBeGreaterThanOrEqual(400);
  });
});

describe('putFile', () => {
  it('creates without a sha and updates with one', async () => {
    const fresh = fakeGitHub();
    const created = await putFile(TOKEN, PATH, 'one\n', null);
    expect(fresh.puts()[0].body?.sha).toBeUndefined();
    expect(fresh.text(PATH)).toBe('one\n');
    expect(created.sha).toBe(fresh.sha(PATH));
    vi.unstubAllGlobals();

    const existing = fakeGitHub({ files: { [PATH]: 'one\n' } });
    const updated = await putFile(TOKEN, PATH, 'one\ntwo\n', existing.sha(PATH) ?? null);
    expect(existing.puts()[0].body?.sha).toBe('sha1');
    expect(existing.text(PATH)).toBe('one\ntwo\n');
    expect(updated.sha).toBe(existing.sha(PATH));
  });

  it('throws when GitHub accepts the write but returns no sha', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'one\n' } });
    github.failPuts.push({ status: 200, body: {} });

    const error = await putFile(TOKEN, PATH, 'two\n', github.sha(PATH) ?? null).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('http');
    expect((error as GitHubError).status).toBeGreaterThanOrEqual(400);
  });
});

describe('appendLines input validation', () => {
  it.each([
    { label: 'an embedded newline', line: 'a\nb' },
    { label: 'a carriage return', line: 'a\rb' },
    { label: 'an empty string', line: '' },
  ])('refuses %s without touching the network', async ({ line }) => {
    const github = fakeGitHub({ files: { [PATH]: 'seed\n' } });

    const error = await appendLines(TOKEN, PATH, ['fine', line]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBeGreaterThanOrEqual(400);
    expect((error as GitHubError).kind).not.toBe('conflict');
    expect(github.calls).toEqual([]);
    expect(github.text(PATH)).toBe('seed\n');
  });

  it('issues no request at all for an empty batch', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'seed\n' } });
    expect(await appendLines(TOKEN, PATH, [])).toBeNull();
    expect(github.calls).toEqual([]);
  });
});

describe('appendLines newline handling', () => {
  it('does not introduce a blank line when the file already ends in a newline', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'one\ntwo\n' } });
    await appendLines(TOKEN, PATH, ['three', 'four']);
    expect(github.text(PATH)).toBe('one\ntwo\nthree\nfour\n');
  });

  it('creates the file with exactly one trailing newline, and repairs a missing one', async () => {
    const fresh = fakeGitHub();
    await appendLines(TOKEN, PATH, ['one']);
    expect(fresh.text(PATH)).toBe('one\n');
    vi.unstubAllGlobals();

    const unterminated = fakeGitHub({ files: { [PATH]: 'one' } });
    await appendLines(TOKEN, PATH, ['two']);
    expect(unterminated.text(PATH)).toBe('one\ntwo\n');
  });

  it('round-trips non-ASCII through encode and decode unchanged', async () => {
    const seeded = '{"note":"café ☕ — naïve 日本語"}\n';
    const added = '{"note":"emoji 🌘 and ümlaut, ünicode ✓"}';
    const github = fakeGitHub({ files: { [PATH]: seeded } });

    await appendLines(TOKEN, PATH, [added]);

    expect(github.text(PATH)).toBe(`${seeded}${added}\n`);
    const read = await getFile(TOKEN, PATH);
    expect(read?.text).toBe(`${seeded}${added}\n`);
  });
});

describe('appendLines conflict retry', () => {
  it.each([409, 422])('refetches exactly once after a %i and retries with the refetched sha', async (status) => {
    vi.useFakeTimers();
    const github = fakeGitHub({ files: { [PATH]: 'first\n' } });
    github.failPuts.push(status);
    github.foreignLine = 'from-other-device';

    const pending = appendLines(TOKEN, PATH, ['mine']);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    const result = await pending;

    expect(github.methods()).toEqual(['GET', 'PUT', 'GET', 'PUT']);
    const puts = github.puts();
    expect(puts[0].body?.sha).toBe('sha1');
    // sha2 is the sha the competing write produced — the retry must carry it, not sha1.
    expect(puts[1].body?.sha).toBe('sha2');
    expect(decode(String(puts[1].body?.content))).toBe('first\nfrom-other-device\nmine\n');
    expect(github.text(PATH)).toBe('first\nfrom-other-device\nmine\n');
    expect(result?.sha).toBe(github.sha(PATH));
  });

  it('waits before retrying rather than hammering GitHub back-to-back', async () => {
    vi.useFakeTimers();
    const github = fakeGitHub({ files: { [PATH]: 'first\n' } });
    github.failPuts.push(409);

    const pending = appendLines(TOKEN, PATH, ['mine']);
    await flush();
    expect(github.methods()).toEqual(['GET', 'PUT']);

    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    await pending;
    expect(github.methods()).toEqual(['GET', 'PUT', 'GET', 'PUT']);
  });

  it('gives up after 3 attempts with a typed conflict error rather than looping', async () => {
    vi.useFakeTimers();
    const github = fakeGitHub({ files: { [PATH]: 'first\n' } });
    github.failPuts.push(409, 409, 409);

    const pending = appendLines(TOKEN, PATH, ['mine']).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    const error = await pending;

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('conflict');
    expect((error as GitHubError).status).toBe(409);
    expect((error as GitHubError).message).not.toContain(TOKEN);
    expect(github.methods()).toEqual(['GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT']);
    expect(github.text(PATH)).toBe('first\n');
  });

  it('stops at the first non-conflict failure instead of spending every attempt', async () => {
    vi.useFakeTimers();
    const github = fakeGitHub({ files: { [PATH]: 'first\n' } });
    github.failPuts.push(500);

    const pending = appendLines(TOKEN, PATH, ['mine']).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
    const error = await pending;

    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('http');
    expect((error as GitHubError).status).toBe(500);
    expect(github.methods()).toEqual(['GET', 'PUT']);
  });
});

describe('appendLines timeout', () => {
  it('aborts a request that never settles and leaves the lock free', async () => {
    vi.useFakeTimers();
    const github = fakeGitHub({ files: { [PATH]: 'seed\n' } });
    github.holding = true;

    const wedged = appendLines(TOKEN, PATH, ['a']).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(github.log).toEqual(['GET start']);

    await vi.advanceTimersByTimeAsync(1);
    const error = await wedged;
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe('network');
    expect((error as GitHubError).message).not.toContain(TOKEN);

    vi.useRealTimers();
    github.holding = false;
    github.pending.length = 0;

    const result = await appendLines(TOKEN, PATH, ['b']);
    expect(result?.sha).toBe(github.sha(PATH));
    expect(github.text(PATH)).toBe('seed\nb\n');
  });
});

describe('appendLines serialization', () => {
  const SEQUENCE = [
    'GET start', 'GET end', 'PUT start', 'PUT end',
    'GET start', 'GET end', 'PUT start', 'PUT end',
  ];

  it('serializes two concurrent appends via the promise-chain fallback', async () => {
    expect((navigator as unknown as { locks?: unknown }).locks).toBeUndefined();
    const github = fakeGitHub({ files: { [PATH]: 'seed\n' } });
    github.holding = true;

    const first = appendLines(TOKEN, PATH, ['a']);
    const second = appendLines(TOKEN, PATH, ['b']);
    await tick();
    expect(github.log).toEqual(['GET start']);

    for (let i = 0; i < 4; i += 1) await releaseNext(github);
    await Promise.all([first, second]);

    expect(github.log).toEqual(SEQUENCE);
    expect(github.text(PATH)).toBe('seed\na\nb\n');
  });

  it('serializes two concurrent appends through navigator.locks when present', async () => {
    let tail: Promise<unknown> = Promise.resolve();
    const names: string[] = [];
    const locks = {
      request<T>(name: string, callback: () => Promise<T>): Promise<T> {
        names.push(name);
        const run = tail.then(callback);
        tail = run.then(() => undefined, () => undefined);
        return run;
      },
    };
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });

    const github = fakeGitHub({ files: { [PATH]: 'seed\n' } });
    github.holding = true;

    const first = appendLines(TOKEN, PATH, ['a']);
    const second = appendLines(TOKEN, PATH, ['b']);
    await tick();
    expect(github.log).toEqual(['GET start']);

    for (let i = 0; i < 4; i += 1) await releaseNext(github);
    await Promise.all([first, second]);

    expect(names).toEqual([PUSH_LOCK_NAME, PUSH_LOCK_NAME]);
    expect(github.log).toEqual(SEQUENCE);
    expect(github.text(PATH)).toBe('seed\na\nb\n');
  });

  it('does not poison the promise chain when an append fails', async () => {
    const github = fakeGitHub({ files: { [PATH]: 'seed\n' } });
    github.failPuts.push(500);

    const failed = await appendLines(TOKEN, PATH, ['a']).catch((caught: unknown) => caught);
    expect(failed).toBeInstanceOf(GitHubError);

    const result = await appendLines(TOKEN, PATH, ['b']);
    expect(result?.sha).toBe(github.sha(PATH));
    expect(github.text(PATH)).toBe('seed\nb\n');
  });
});
