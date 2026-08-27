/**
 * The calendar mirror's sync.
 *
 * Three things carry risk and are what this covers.
 *
 * The head check has to actually stop the sync: the action commits only when
 * events change, so most opens should cost one request, and a short-circuit
 * that quietly stopped working would fetch the tree and the file on every
 * focus for the life of the app.
 *
 * The head must be recorded only once the file it describes has landed. A head
 * stored before that tells the next open everything is already here, and the
 * file is never fetched again.
 *
 * And the two mirrors share one store. A calendar file that landed in the
 * newsletters namespace, or that overwrote something there, would show up as a
 * reading pane with a hole in it rather than as a calendar error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cachedContentShas, closeDb, getCachedContent, getMeta, putCachedContent } from './db';
import { GitHubError } from './github';

const mocks = vi.hoisted(() => ({
  getHeadSha: vi.fn(),
  getTree: vi.fn(),
  getBlob: vi.fn(),
}));

vi.mock('./gitread', async importOriginal => ({
  ...(await importOriginal<typeof import('./gitread')>()),
  getHeadSha: mocks.getHeadSha,
  getTree: mocks.getTree,
  getBlob: mocks.getBlob,
}));

const { loadCalendar, syncCalendar, calendarParseError } = await import('./calendarSync');

const TOKEN = 'test-token-not-a-real-pat';

const TREE = [
  { path: 'events.json', sha: 'e1', size: 900 },
  { path: 'README.md', sha: 'r1', size: 100 },
  { path: 'scripts/mirror.py', sha: 'm1', size: 400 },
];

const EVENTS = JSON.stringify({
  generated_at: '2026-08-27T04:10:31Z',
  window: { start: '2026-08-20', end: '2026-10-26' },
  calendars: ['home'],
  events: [
    {
      id: '0123456789abcdef',
      calendar: 'home',
      title: 'standup',
      start: '2026-08-27T01:30:00Z',
      end: '2026-08-27T02:00:00Z',
      allDay: false,
    },
  ],
});

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
  mocks.getBlob.mockResolvedValue(EVENTS);
});

afterEach(async () => {
  await closeDb();
});

describe('syncing the mirror', () => {
  it('reads the tree and the file when there is nothing cached', async () => {
    mocks.getHeadSha.mockResolvedValue('head-1');
    mocks.getTree.mockResolvedValue(TREE);

    const result = await syncCalendar(TOKEN);

    expect(result).toEqual({ changed: true, fetched: 1, head: 'head-1' });
    expect(await getMeta('gitread:calendar-data:headSha')).toBe('head-1');
    expect((await getCachedContent('calendar-data', 'events.json'))?.sha).toBe('e1');
  });

  it('fetches only events.json, not the script or the readme beside it', async () => {
    mocks.getHeadSha.mockResolvedValue('head-1');
    mocks.getTree.mockResolvedValue(TREE);

    await syncCalendar(TOKEN);

    expect(mocks.getBlob).toHaveBeenCalledTimes(1);
    expect(await cachedContentShas('calendar-data')).toEqual(new Map([['events.json', 'e1']]));
  });

  it('stops at the head when nothing has moved', async () => {
    mocks.getHeadSha.mockResolvedValue('head-1');
    mocks.getTree.mockResolvedValue(TREE);
    await syncCalendar(TOKEN);
    mocks.getTree.mockClear();
    mocks.getBlob.mockClear();

    const result = await syncCalendar(TOKEN);

    expect(result).toEqual({ changed: false, fetched: 0, head: 'head-1' });
    expect(mocks.getTree).not.toHaveBeenCalled();
    expect(mocks.getBlob).not.toHaveBeenCalled();
  });

  it('re-reads the tree but not the file when only the head moved', async () => {
    mocks.getHeadSha.mockResolvedValue('head-1');
    mocks.getTree.mockResolvedValue(TREE);
    await syncCalendar(TOKEN);
    mocks.getBlob.mockClear();

    // A heartbeat commit: the head is new, events.json is the same blob.
    mocks.getHeadSha.mockResolvedValue('head-2');
    const result = await syncCalendar(TOKEN);

    expect(result).toEqual({ changed: false, fetched: 0, head: 'head-2' });
    expect(mocks.getBlob).not.toHaveBeenCalled();
  });

  it('does not record the head when the file could not be fetched', async () => {
    mocks.getHeadSha.mockResolvedValue('head-1');
    mocks.getTree.mockResolvedValue(TREE);
    mocks.getBlob.mockRejectedValue(new GitHubError('nope', 500, 'http'));

    await expect(syncCalendar(TOKEN)).rejects.toBeInstanceOf(GitHubError);

    expect(await getMeta('gitread:calendar-data:headSha')).toBeUndefined();
    expect(await getCachedContent('calendar-data', 'events.json')).toBeUndefined();
  });

  it('leaves the newsletters namespace alone', async () => {
    await putCachedContent('newsletters', {
      path: 'events.json',
      text: 'a newsletters file that happens to share the name',
      sha: 'n1',
      fetchedAt: 1,
    });
    mocks.getHeadSha.mockResolvedValue('head-1');
    mocks.getTree.mockResolvedValue(TREE);

    await syncCalendar(TOKEN);

    expect((await getCachedContent('newsletters', 'events.json'))?.sha).toBe('n1');
    expect((await getCachedContent('calendar-data', 'events.json'))?.sha).toBe('e1');
  });
});

describe('reading the cached mirror', () => {
  it('is null before anything has synced, with no request made', async () => {
    expect(await loadCalendar()).toBeNull();
    expect(mocks.getHeadSha).not.toHaveBeenCalled();
  });

  it('serves the cached file with no network at all', async () => {
    await putCachedContent('calendar-data', {
      path: 'events.json',
      text: EVENTS,
      sha: 'e1',
      fetchedAt: 1,
    });

    const mirror = await loadCalendar();

    expect(mirror?.events).toHaveLength(1);
    expect(mirror?.calendars).toEqual(['home']);
    expect(mocks.getHeadSha).not.toHaveBeenCalled();
    expect(await calendarParseError()).toBeNull();
  });

  it('reports a cached file that will not parse rather than throwing', async () => {
    await putCachedContent('calendar-data', {
      path: 'events.json',
      text: 'half a fi',
      sha: 'e1',
      fetchedAt: 1,
    });

    expect(await loadCalendar()).toBeNull();
    expect(await calendarParseError()).not.toBeNull();
  });
});
