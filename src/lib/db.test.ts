import { forceCloseDatabase } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  allCachedFiles,
  clearToken,
  closeDb,
  DbError,
  enqueue,
  getCachedFile,
  getDeviceId,
  getMeta,
  getState,
  getToken,
  nextSeq,
  openDb,
  outboxSize,
  peekOutbox,
  putCachedFile,
  removeFromOutbox,
  requestPersistence,
  setMeta,
  setState,
  setToken,
} from './db'

type TestEvent = {
  id: string
  seq: number
  entity: string
}

const event = (id: string, seq: number): TestEvent => ({ id, seq, entity: 'habit' })

/** Simulates an app restart: drop the cached handle so the next call reopens. */
async function reopen(): Promise<void> {
  await closeDb()
}

async function metaKeys(): Promise<IDBValidKey[]> {
  const db = await openDb()
  const req = db.transaction('meta', 'readonly').objectStore('meta').getAllKeys()
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Whatever the promise rejected with, as a value the test can assert on. */
function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection, but the call resolved')
    },
    (error: unknown) => error
  )
}

/**
 * Wraps the cached handle's `transaction` so a test can watch, or interfere
 * with, the transactions the module opens on it.
 */
async function interceptTransactions(
  onTx: (tx: IDBTransaction, mode: IDBTransactionMode) => void
): Promise<void> {
  const db = await openDb()
  const start = db.transaction.bind(db)
  db.transaction = (
    storeNames: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions
  ): IDBTransaction => {
    const tx = start(storeNames, mode, options)
    onTx(tx, mode ?? 'readonly')
    return tx
  }
}

afterEach(async () => {
  await closeDb()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('meridian')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
    // Silently leaving the database behind would pollute the next test.
    req.onblocked = () =>
      reject(new Error('deleteDatabase was blocked: a test leaked an open connection'))
  })
})

describe('store round-trips', () => {
  it('writes and reads back the folded state', async () => {
    expect(await getState()).toBeUndefined()
    await setState({ habit: { h1: { title: 'run' } } })
    expect(await getState()).toEqual({ habit: { h1: { title: 'run' } } })
  })

  it('writes and reads back a meta scalar', async () => {
    expect(await getMeta('lastBackupAt')).toBeUndefined()
    expect(await getMeta('lastBackupAt', 0)).toBe(0)
    await setMeta('lastBackupAt', 1755990000000)
    expect(await getMeta<number>('lastBackupAt')).toBe(1755990000000)
  })

  it('writes and reads back an outbox event', async () => {
    await enqueue([event('e1', 1)])
    expect(await peekOutbox<TestEvent>()).toEqual([event('e1', 1)])
    expect(await outboxSize()).toBe(1)
  })

  it('writes and reads back a cached journal file', async () => {
    const record = {
      path: 'journal/2026-08.laptop.jsonl',
      text: '{"id":"e1"}\n',
      sha: 'abc123',
      fetchedAt: 1755990000000,
    }
    await putCachedFile(record)
    expect(await getCachedFile(record.path)).toEqual(record)
    expect(await allCachedFiles()).toEqual([record])
  })

  it('keeps a null sha on a cached file', async () => {
    const record = { path: 'journal/new.jsonl', text: '', sha: null, fetchedAt: 1 }
    await putCachedFile(record)
    expect((await getCachedFile('journal/new.jsonl'))?.sha).toBeNull()
  })
})

describe('nextSeq', () => {
  it('is strictly increasing across a close and reopen', async () => {
    expect(await nextSeq()).toBe(1)
    expect(await nextSeq()).toBe(2)

    await reopen()

    expect(await nextSeq()).toBe(3)
    expect(await nextSeq()).toBe(4)
    expect(await getMeta<number>('seq')).toBe(4)
  })

  it('never hands out the same value twice under concurrency', async () => {
    const values = await Promise.all([nextSeq(), nextSeq(), nextSeq(), nextSeq(), nextSeq()])
    expect(new Set(values).size).toBe(values.length)
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    // The counter must be left exactly where the last handout put it.
    expect(await getMeta<number>('seq')).toBe(5)
  })

  it('commits the counter before it hands the number out', async () => {
    // The durability rule is about ORDER, so observe the order directly: a
    // follow-up read cannot see the difference, because IndexedDB will not
    // start it until the readwrite transaction has finished either way.
    const order: string[] = []
    await interceptTransactions((tx) => {
      tx.addEventListener('complete', () => order.push('tx-complete'))
    })

    await nextSeq()
    order.push('nextSeq-returned')

    expect(order).toEqual(['tx-complete', 'nextSeq-returned'])
  })
})

describe('outbox', () => {
  it('survives a close and reopen', async () => {
    await enqueue([event('e1', 1), event('e2', 2)])
    await reopen()
    expect(await outboxSize()).toBe(2)
    expect((await peekOutbox<TestEvent>()).map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('drains in seq order even when enqueued out of order', async () => {
    await enqueue([event('c', 30)])
    await enqueue([event('a', 10), event('d', 40)])
    await enqueue([event('b', 20)])
    expect((await peekOutbox<TestEvent>()).map((e) => e.seq)).toEqual([10, 20, 30, 40])
    expect((await peekOutbox<TestEvent>(2)).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('returns nothing when the caller asks for no rows', async () => {
    await enqueue([event('a', 1), event('b', 2)])
    // getAll(query, 0) means "no limit" to IndexedDB; a drain loop out of
    // budget must get an empty batch, not the whole outbox.
    expect(await peekOutbox(0)).toEqual([])
    expect(await peekOutbox(1)).toHaveLength(1)
  })

  it('removes only the named ids', async () => {
    await enqueue([event('a', 1), event('b', 2), event('c', 3)])
    await removeFromOutbox(['a', 'c'])
    expect((await peekOutbox<TestEvent>()).map((e) => e.id)).toEqual(['b'])
    expect(await outboxSize()).toBe(1)
  })

  it('ignores ids that are not queued', async () => {
    await enqueue([event('a', 1)])
    await removeFromOutbox(['nope'])
    expect(await outboxSize()).toBe(1)
  })
})

describe('outbox rejects records it could never drain', () => {
  const unqueueable = (record: unknown) => enqueue([record as TestEvent])

  it.each([
    ['an undefined seq', { id: 'e1', entity: 'habit' }],
    ['a null seq', { id: 'e1', seq: null, entity: 'habit' }],
    ['a NaN seq', { id: 'e1', seq: Number.NaN, entity: 'habit' }],
  ])('refuses a record with %s and names it', async (_case, record) => {
    const error = await rejection(unqueueable(record))
    expect(error).toBeInstanceOf(DbError)
    expect((error as DbError).kind).toBe('invalidRecord')
    expect((error as Error).message).toContain('e1')
    expect(await outboxSize()).toBe(0)
  })

  it.each([
    ['no id', { seq: 1, entity: 'habit' }],
    ['an empty id', { id: '', seq: 1, entity: 'habit' }],
  ])('refuses a record with %s', async (_case, record) => {
    const error = await rejection(unqueueable(record))
    expect(error).toBeInstanceOf(DbError)
    expect((error as DbError).kind).toBe('invalidRecord')
    expect(await outboxSize()).toBe(0)
  })

  it('queues nothing at all when one record in the batch is bad', async () => {
    const error = await rejection(
      enqueue([event('good', 1), { id: 'bad', seq: Number.NaN, entity: 'habit' }])
    )
    expect(error).toBeInstanceOf(DbError)
    expect(await outboxSize()).toBe(0)
  })
})

describe('failing writes', () => {
  it('rejects with a real error that carries a message, never null', async () => {
    // A duplicate key wedged into the same transaction fails asynchronously,
    // which is exactly the shape where tx.error is still null at onerror time.
    await interceptTransactions((tx, mode) => {
      if (mode !== 'readwrite') return
      const store = tx.objectStore('outbox')
      store.add({ id: 'clash', seq: 1 })
      store.add({ id: 'clash', seq: 2 })
    })

    const error = await rejection(enqueue([event('a', 1)]))

    expect(error).toBeInstanceOf(Error)
    expect(typeof (error as Error).message).toBe('string')
    expect((error as Error).message.length).toBeGreaterThan(0)
    expect((error as DbError).kind).toBe('transaction')
  })

  it('commits none of the batch when one record cannot be stored', async () => {
    // A function is not structured-cloneable, so put() throws synchronously
    // part-way through the batch.
    const uncloneable = { id: 'b', seq: 2, entity: 'habit', onDone: () => undefined }

    const error = await rejection(
      enqueue([event('a', 1), uncloneable as unknown as TestEvent, event('c', 3)])
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message.length).toBeGreaterThan(0)
    expect(await outboxSize()).toBe(0)
    expect(await peekOutbox()).toEqual([])
  })
})

describe('connection recovery', () => {
  it('drops a handle that died out of band', async () => {
    await setState({ habit: {} })
    const db = await openDb()

    // The type shipped with fake-indexeddb asks for the constructor, not an
    // instance; this is a database being closed the way clearing site data
    // closes it.
    forceCloseDatabase(db as unknown as typeof IDBDatabase)

    expect(await openDb()).not.toBe(db)
    expect(await getState()).toEqual({ habit: {} })
  })

  it('reopens when the cached handle turns out to be dead', async () => {
    await setState({ habit: {} })
    const db = await openDb()

    // An explicit close fires no event, so the module cannot know: every
    // transaction on this handle now throws synchronously.
    db.close()

    expect(await getState()).toEqual({ habit: {} })
    await setState({ habit: { h1: {} } })
    expect(await getState()).toEqual({ habit: { h1: {} } })
  })
})

describe('deviceId', () => {
  const realCrypto = globalThis.crypto

  const useCrypto = (value: unknown) => {
    Object.defineProperty(globalThis, 'crypto', { value, configurable: true })
  }

  afterEach(() => {
    useCrypto(realCrypto)
    vi.restoreAllMocks()
  })

  it('is stable across a close and reopen', async () => {
    const first = await getDeviceId()
    expect(first).toHaveLength(8)
    expect(await getDeviceId()).toBe(first)

    await reopen()

    expect(await getDeviceId()).toBe(first)
    expect(await getMeta<string>('deviceId')).toBe(first)
  })

  it('mints exactly one id when the first calls race', async () => {
    const minted = vi.spyOn(realCrypto, 'randomUUID')

    const ids = await Promise.all([getDeviceId(), getDeviceId(), getDeviceId(), getDeviceId()])

    expect(new Set(ids).size).toBe(1)
    expect(minted).toHaveBeenCalledTimes(1)
    expect(await getMeta<string>('deviceId')).toBe(ids[0])
  })

  it('mints an id without randomUUID, which insecure origins do not expose', async () => {
    let calls = 0
    useCrypto({
      getRandomValues: (buffer: Uint8Array) => {
        calls += 1
        buffer.fill(7)
        return buffer
      },
    })

    const id = await getDeviceId()

    expect(calls).toBe(1)
    expect(id).toHaveLength(8)
    expect(await getMeta<string>('deviceId')).toBe(id)
  })

  it('reports why it cannot mint an id when no random source exists', async () => {
    useCrypto({})

    const error = await rejection(getDeviceId())

    expect(error).toBeInstanceOf(DbError)
    expect((error as DbError).kind).toBe('unsupported')
    expect((error as Error).message.length).toBeGreaterThan(0)
    // Not the bare, message-less AbortError a throw inside onsuccess produces.
    expect((error as Error).name).not.toBe('AbortError')
  })
})

describe('token', () => {
  it('round-trips and leaves no residue after clearing', async () => {
    expect(await getToken()).toBeUndefined()
    await setToken('ghp_example_value')
    expect(await getToken()).toBe('ghp_example_value')
    expect(await metaKeys()).toContain('token')

    await clearToken()

    expect(await getToken()).toBeUndefined()
    expect(await metaKeys()).not.toContain('token')
  })
})

describe('requestPersistence', () => {
  const set = (value: unknown) => {
    Object.defineProperty(navigator, 'storage', { value, configurable: true })
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
  })

  it('returns false and does not throw when navigator.storage is absent', async () => {
    set(undefined)
    await expect(requestPersistence()).resolves.toBe(false)
  })

  it('returns false when persist() is missing from the storage manager', async () => {
    set({})
    await expect(requestPersistence()).resolves.toBe(false)
  })

  it('returns the boolean the browser gives back', async () => {
    set({ persist: () => Promise.resolve(true) })
    await expect(requestPersistence()).resolves.toBe(true)
  })

  it('returns false when persist() rejects', async () => {
    set({ persist: () => Promise.reject(new Error('denied')) })
    await expect(requestPersistence()).resolves.toBe(false)
  })
})
