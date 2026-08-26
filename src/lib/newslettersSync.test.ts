/**
 * The newsletters sync and its selectors.
 *
 * The selectors decide what gets fetched, so a mistake in one is either a
 * library with holes in it or a phone re-downloading the corpus every time the
 * window is focused. They are pure, and they are tested against the shapes the
 * real repo actually has: placeholder directories under `raw/`, a gists file
 * whose own prose header contains the separator its entries use, and slugs
 * that lead with a date.
 *
 * The flow itself has one job beyond fetching: never to record a head it has
 * not finished fetching. A sync that dies half way through has to leave enough
 * behind for the next one to pick up exactly what is missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getCachedContent, getMeta, putCachedContent, setMeta } from './db';
import { GitHubError } from './github';
import type { TreeEntry } from './newsletters';
import {
  buildLibrary,
  loadLibrary,
  parseGists,
  selectEntrySlugs,
  selectStale,
  selectStateTier,
  syncNewsletters,
} from './newslettersSync';

const mocks = vi.hoisted(() => ({
  getHeadSha: vi.fn(),
  getTree: vi.fn(),
  getBlob: vi.fn(),
}));

vi.mock('./newsletters', () => ({
  getHeadSha: mocks.getHeadSha,
  getTree: mocks.getTree,
  getBlob: mocks.getBlob,
}));

const TOKEN = 'test-token-not-a-real-pat';

const file = (path: string, sha: string, size = 10): TreeEntry => ({ path, sha, size });

/** A slice of the real repo: two placeholder dirs, two entries, the state tier. */
const TREE: TreeEntry[] = [
  file('raw/newsletters/.gitkeep', 'k1'),
  file('raw/chats/chatgpt/.gitkeep', 'k2'),
  file('raw/2026-08-18--sample-macro/2026-08-18--sample-macro.md', 'e1'),
  file('raw/2026-08-21--lex-asia/2026-08-21--lex-asia.md', 'e2'),
  file('raw/2026-08-21--lex-asia/figures.md', 'f2'),
  file('state/gists.md', 'g1'),
  file('state/tape.json', 't1'),
  file('state/briefs/2026-08-25.md', 'b1'),
  file('state/charts/2026-08-08--power/chart.json', 'c1'),
  file('state/canon/lessons/marks-sea-change/day-01.json', 'n1'),
  file('wiki/essays/2026-07-07--bubble.md', 'w1'),
  file('wiki/essays/.gitkeep', 'k3'),
  file('wiki/concepts/pain-seeker.md', 'x1'),
  file('README.md', 'r1'),
];

const GISTS = [
  '# Corpus gists — one line per raw/ entry',
  '',
  'Machine-maintained index. Format: `<slug> | <the piece’s actual claim>`. Sorted by slug.',
  '',
  '2026-08-18--sample-macro | The long end does the tightening the Fed will not.',
  '2026-08-21--lex-asia | Beijing taxes offshore savings products; AIA and Prudential rattled.',
  '2026-01-01--not-in-the-tree | An entry whose directory is gitignored, so it is not here.',
].join('\n');

async function resetDb(): Promise<void> {
  await closeDb();
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('meridian');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetDb();
  mocks.getHeadSha.mockReset();
  mocks.getTree.mockReset();
  mocks.getBlob.mockReset();
  mocks.getBlob.mockImplementation((_token: string, sha: string) => Promise.resolve(`body:${sha}`));
});

afterEach(async () => {
  await resetDb();
});

describe('the state tier', () => {
  it('takes everything the pane renders from', () => {
    expect(selectStateTier(TREE).map(entry => entry.path)).toEqual([
      'state/gists.md',
      'state/tape.json',
      'state/briefs/2026-08-25.md',
      'state/charts/2026-08-08--power/chart.json',
      'state/canon/lessons/marks-sea-change/day-01.json',
      'wiki/essays/2026-07-07--bubble.md',
    ]);
  });

  it('leaves the source prose out of it — that is the bulk of the repo', () => {
    const paths = selectStateTier(TREE).map(entry => entry.path);
    expect(paths.some(path => path.startsWith('raw/'))).toBe(false);
  });

  it('does not spend a request on an empty-directory marker', () => {
    const paths = selectStateTier(TREE).map(entry => entry.path);
    expect(paths).not.toContain('wiki/essays/.gitkeep');
  });
});

describe('the sha diff', () => {
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

describe('the entry list', () => {
  it('is the directories that hold a markdown file named after them', () => {
    expect(selectEntrySlugs(TREE)).toEqual([
      '2026-08-18--sample-macro',
      '2026-08-21--lex-asia',
    ]);
  });

  it('excludes the empty placeholder directories that also live under raw/', () => {
    expect(selectEntrySlugs(TREE)).not.toContain('newsletters');
    expect(selectEntrySlugs(TREE)).not.toContain('chats');
  });
});

describe('the gists file', () => {
  it('does not mistake its own prose header for an entry', () => {
    const known = new Set(selectEntrySlugs(TREE));
    const gists = parseGists(GISTS, known);

    expect(gists.size).toBe(2);
    for (const slug of gists.keys()) expect(known.has(slug)).toBe(true);
  });

  it('reads the gist as everything after the separator', () => {
    const gists = parseGists(GISTS, new Set(selectEntrySlugs(TREE)));
    expect(gists.get('2026-08-18--sample-macro')).toBe(
      'The long end does the tightening the Fed will not.'
    );
  });

  it('ignores a gist for an entry the tree does not have', () => {
    const gists = parseGists(GISTS, new Set(selectEntrySlugs(TREE)));
    expect(gists.has('2026-01-01--not-in-the-tree')).toBe(false);
  });
});

describe('the library', () => {
  it('is newest first, by the date the slug carries', () => {
    expect(buildLibrary(TREE, GISTS).map(row => row.slug)).toEqual([
      '2026-08-21--lex-asia',
      '2026-08-18--sample-macro',
    ]);
  });

  it('splits the slug into the date and the name the corpus knows it by', () => {
    const [first] = buildLibrary(TREE, GISTS);
    expect(first.date).toBe('2026-08-21');
    expect(first.name).toBe('lex-asia');
  });

  it('keeps an entry that has no gist line', () => {
    const rows = buildLibrary([...TREE, file('raw/2026-08-22--fresh/2026-08-22--fresh.md', 'e3')], GISTS);
    expect(rows[0].slug).toBe('2026-08-22--fresh');
    expect(rows[0].gist).toBeNull();
  });

  it('survives a cached tree that is not a tree', async () => {
    await setMeta('nlTree', 'not a tree at all');
    await expect(loadLibrary()).resolves.toEqual([]);
  });
});

describe('syncing', () => {
  it('stops at the head when nothing has moved', async () => {
    await setMeta('nlHeadSha', 'head-1');
    await setMeta('nlTree', TREE);
    mocks.getHeadSha.mockResolvedValue('head-1');

    await expect(syncNewsletters(TOKEN)).resolves.toEqual({
      changed: false,
      fetched: 0,
      head: 'head-1',
    });
    expect(mocks.getTree).not.toHaveBeenCalled();
    expect(mocks.getBlob).not.toHaveBeenCalled();
  });

  it('reads the tree and the state tier when the head has moved', async () => {
    mocks.getHeadSha.mockResolvedValue('head-2');
    mocks.getTree.mockResolvedValue(TREE);

    const result = await syncNewsletters(TOKEN);

    expect(result).toEqual({ changed: true, fetched: 6, head: 'head-2' });
    expect(await getMeta('nlHeadSha')).toBe('head-2');
    expect((await getCachedContent('state/gists.md'))?.text).toBe('body:g1');
  });

  it('fetches only what moved on the next sync', async () => {
    mocks.getHeadSha.mockResolvedValue('head-2');
    mocks.getTree.mockResolvedValue(TREE);
    await syncNewsletters(TOKEN);

    mocks.getBlob.mockClear();
    mocks.getHeadSha.mockResolvedValue('head-3');
    mocks.getTree.mockResolvedValue(
      TREE.map(entry => (entry.path === 'state/gists.md' ? file('state/gists.md', 'g2') : entry))
    );

    const result = await syncNewsletters(TOKEN);

    expect(result.fetched).toBe(1);
    expect(mocks.getBlob).toHaveBeenCalledTimes(1);
  });

  it('does not record a head whose files it never finished fetching', async () => {
    mocks.getHeadSha.mockResolvedValue('head-2');
    mocks.getTree.mockResolvedValue(TREE);
    mocks.getBlob.mockImplementation((_token: string, sha: string) =>
      sha === 'c1'
        ? Promise.reject(new GitHubError('nope', 500, 'http'))
        : Promise.resolve(`body:${sha}`)
    );

    await expect(syncNewsletters(TOKEN)).rejects.toBeInstanceOf(GitHubError);

    expect(await getMeta('nlHeadSha')).toBeUndefined();
    expect(await getMeta('nlTreeFetchedAt')).toBeUndefined();
    // What did land is kept: the next sync picks up only what is missing.
    expect((await getCachedContent('state/gists.md'))?.text).toBe('body:g1');
  });

  it('resumes from where the failed sync stopped', async () => {
    mocks.getHeadSha.mockResolvedValue('head-2');
    mocks.getTree.mockResolvedValue(TREE);
    mocks.getBlob.mockImplementationOnce(() => Promise.reject(new GitHubError('nope', 500, 'http')));
    await expect(syncNewsletters(TOKEN)).rejects.toBeInstanceOf(GitHubError);

    mocks.getBlob.mockClear();
    mocks.getBlob.mockImplementation((_token: string, sha: string) => Promise.resolve(`body:${sha}`));

    const result = await syncNewsletters(TOKEN);

    expect(result.fetched).toBe(6);
    expect(await getMeta('nlHeadSha')).toBe('head-2');
  });

  it('runs one sync at a time, however many ask for it', async () => {
    mocks.getHeadSha.mockResolvedValue('head-2');
    mocks.getTree.mockResolvedValue(TREE);

    const [a, b] = await Promise.all([syncNewsletters(TOKEN), syncNewsletters(TOKEN)]);

    expect(a).toEqual(b);
    expect(mocks.getTree).toHaveBeenCalledTimes(1);
  });

  it('serves the library from cache with no network at all', async () => {
    await setMeta('nlTree', TREE);
    await putCachedContent({ path: 'state/gists.md', text: GISTS, sha: 'g1', fetchedAt: 1 });

    const rows = await loadLibrary();

    expect(rows.map(row => row.slug)).toEqual([
      '2026-08-21--lex-asia',
      '2026-08-18--sample-macro',
    ]);
    expect(rows[1].gist).toContain('The long end');
    expect(mocks.getHeadSha).not.toHaveBeenCalled();
  });
});
