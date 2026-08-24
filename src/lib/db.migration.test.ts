/**
 * The v1 → v2 upgrade.
 *
 * v2 exists to add one store. Every other store, index and record in the
 * database predates it and belongs to the journal — the outbox in particular
 * can be holding edits that have not reached GitHub yet, and an upgrade that
 * dropped it would lose them with no error and no way back.
 *
 * So this opens a real v1 database, fills every store, and then opens it
 * through the app's own accessor to prove the bump adds a store and touches
 * nothing else.
 */

import { describe, expect, it } from 'vitest';

import {
  allCachedFiles,
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

function put(db: IDBDatabase, store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('opening a v1 database at v2', () => {
  it('adds the content cache and leaves everything else where it was', async () => {
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

    expect(db.version).toBe(2);
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
    await putCachedContent({ path: 'state/gists.md', text: 'a | b', sha: 'g1', fetchedAt: 9 });
    await expect(getCachedContent('state/gists.md')).resolves.toMatchObject({ sha: 'g1' });
  });
});
