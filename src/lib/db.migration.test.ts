/**
 * The schema upgrades, run against real databases built by hand at the old
 * version rather than by db.ts.
 *
 * v2 exists to add one store. Every other store, index and record in the
 * database predates it and belongs to the journal — the outbox in particular
 * can be holding edits that have not reached GitHub yet, and an upgrade that
 * dropped it would lose them with no error and no way back.
 *
 * v3 renames every key in that store, because a second mirror repo now shares
 * it. A rename is the upgrade with the most room to lose data quietly: the
 * file is still there, under a name nothing asks for, and the only symptom is
 * a corpus that re-downloads itself. So the v2 case below asserts the content
 * survives byte for byte, not merely that something is present.
 *
 * There is no rollback. A v2 build opening a v3 database throws, so both of
 * these run once, forwards, on a device that cannot go back.
 */

import { describe, expect, it } from 'vitest';

import {
  allCachedFiles,
  cachedContentShas,
  closeDb,
  getCachedContent,
  getMeta,
  getState,
  openDb,
  outboxSize,
  peekOutbox,
  putCachedContent,
} from './db';

const V1_STORES = ['state', 'journalCache', 'outbox', 'meta'];

/** The v1 schema exactly as it shipped, written by hand rather than by db.ts. */
function openV1(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('meridian', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('state');
      db.createObjectStore('journalCache', { keyPath: 'path' });
      db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('bySeq', 'seq', {
        unique: false,
      });
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The v2 schema exactly as it shipped: v1 plus the bare-keyed content cache. */
function openV2(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('meridian', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('state');
      db.createObjectStore('journalCache', { keyPath: 'path' });
      db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('bySeq', 'seq', {
        unique: false,
      });
      db.createObjectStore('meta');
      db.createObjectStore('contentCache', { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Reads one record by its raw key, which is the whole point of these tests. */
function getRaw(db: IDBDatabase, store: string, key: IDBValidKey): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function resetDb(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('meridian');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
    req.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'));
  });
}

function put(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('opening a v1 database at the current version', () => {
  it('adds the content cache and leaves everything else where it was', async () => {
    await resetDb();
    const v1 = await openV1();
    await put(v1, 'state', { habit: { a: { name: 'run' } } }, 'current');
    await put(v1, 'journalCache', {
      path: 'journal/2026-08.laptop.jsonl',
      text: '{"id":"e1"}\n',
      sha: 'sha-1',
      fetchedAt: 7,
    });
    await put(v1, 'outbox', { id: 'e1', seq: 4, entity: 'habit' });
    await put(v1, 'meta', 'laptop', 'deviceId');
    await put(v1, 'meta', 4, 'seq');
    v1.close();

    const db = await openDb();

    expect(db.version).toBe(3);
    for (const store of V1_STORES) expect(db.objectStoreNames.contains(store)).toBe(true);
    expect(db.objectStoreNames.contains('contentCache')).toBe(true);

    // The records, not just the stores.
    await expect(getState()).resolves.toEqual({ habit: { a: { name: 'run' } } });
    await expect(getMeta('deviceId')).resolves.toBe('laptop');
    await expect(getMeta('seq')).resolves.toBe(4);
    await expect(outboxSize()).resolves.toBe(1);
    await expect(peekOutbox()).resolves.toEqual([{ id: 'e1', seq: 4, entity: 'habit' }]);

    const cached = await allCachedFiles();
    expect(cached).toHaveLength(1);
    expect(cached[0].sha).toBe('sha-1');

    // And the index the outbox drains in order by is still an index.
    const outbox = db.transaction('outbox', 'readonly').objectStore('outbox');
    expect(Array.from(outbox.indexNames)).toContain('bySeq');

    // The new store works.
    await putCachedContent('newsletters', {
      path: 'state/gists.md',
      text: 'a | b',
      sha: 'g1',
      fetchedAt: 9,
    });
    await expect(getCachedContent('newsletters', 'state/gists.md')).resolves.toMatchObject({
      sha: 'g1',
    });
  });
});

describe('opening a v2 database at v3', () => {
  it('namespaces every content-cache key and rewrites nothing else about the record', async () => {
    await resetDb();
    const v2 = await openV2();

    // Two files with the prose and the accents the decoder exists for: if the
    // upgrade round-trips them through anything, this is where it shows.
    const gists = {
      path: 'state/gists.md',
      text: '2026-08-21--lex-asia | a piece about the région\n',
      sha: 'g1',
      fetchedAt: 111,
    };
    const brief = {
      path: 'state/briefs/2026-08-25.md',
      text: '# brief — 25 Aug\n\nsomething happened.\n',
      sha: 'b1',
      fetchedAt: 222,
    };
    await put(v2, 'contentCache', gists);
    await put(v2, 'contentCache', brief);

    // The journal side rides along untouched, as it did through v2.
    await put(v2, 'outbox', { id: 'e9', seq: 12 });
    await put(v2, 'meta', 'phone', 'deviceId');
    // And the sync scalars v3 drops.
    await put(v2, 'meta', 'head-abc', 'nlHeadSha');
    await put(v2, 'meta', [{ path: 'state/gists.md', sha: 'g1', size: 4 }], 'nlTree');
    await put(v2, 'meta', 999, 'nlTreeFetchedAt');
    v2.close();

    const db = await openDb();
    expect(db.version).toBe(3);

    // Read back through the accessor: the path comes out bare, the rest whole.
    await expect(getCachedContent('newsletters', gists.path)).resolves.toEqual(gists);
    await expect(getCachedContent('newsletters', brief.path)).resolves.toEqual(brief);

    // And read back by raw key, because the accessor would hide a key that
    // never actually moved.
    expect(await getRaw(db, 'contentCache', 'newsletters:state/gists.md')).toEqual({
      ...gists,
      path: 'newsletters:state/gists.md',
    });
    expect(await getRaw(db, 'contentCache', 'state/gists.md')).toBeUndefined();

    // The diff the next sync runs on sees bare paths, so nothing looks stale.
    expect(await cachedContentShas('newsletters')).toEqual(
      new Map([
        ['state/gists.md', 'g1'],
        ['state/briefs/2026-08-25.md', 'b1'],
      ])
    );
    // The other mirror's namespace is empty, not a copy of this one.
    expect(await cachedContentShas('calendar-data')).toEqual(new Map());

    // The journal side survived the rename it had no part in.
    await expect(getMeta('deviceId')).resolves.toBe('phone');
    await expect(outboxSize()).resolves.toBe(1);

    // The v2 sync scalars are gone rather than left to be read by accident.
    for (const key of ['nlHeadSha', 'nlTree', 'nlTreeFetchedAt']) {
      expect(await getRaw(db, 'meta', key)).toBeUndefined();
    }
  });
});
