/**
 * IndexedDB local layer.
 *
 * The working copy of Meridian's data: the folded state, the journal file
 * cache, the outbox of unpushed events, and a handful of scalars. GitHub is
 * the durable store; this is the fast, offline-capable copy.
 *
 * Browser storage is IndexedDB only. No wrapper library — the IDBRequest
 * promise-wrapping below is the whole of it.
 */

import type { GitReadRepo } from './gitread'

const DB_NAME = 'meridian'
/**
 * v2 added `contentCache` for the read-only newsletters repo. v3 namespaces
 * that store's keys by repo, because a second mirror now shares it.
 */
const DB_VERSION = 3

const STATE = 'state'
const JOURNAL_CACHE = 'journalCache'
const OUTBOX = 'outbox'
const META = 'meta'
const CONTENT_CACHE = 'contentCache'

/**
 * Separates the repo from the path inside a `contentCache` key. A colon cannot
 * appear in a git path, so the split is unambiguous — a machine-defined format,
 * not a guess about the text.
 */
const CACHE_NAMESPACE_SEPARATOR = ':'

const BY_SEQ = 'bySeq'
const STATE_KEY = 'current'
const DEVICE_ID_LENGTH = 8

type StoreName =
  | typeof STATE
  | typeof JOURNAL_CACHE
  | typeof OUTBOX
  | typeof META
  | typeof CONTENT_CACHE

/** Scalars kept in the `meta` store. */
export type MetaKey =
  | 'deviceId'
  | 'seq'
  | 'token'
  | 'lastBackupAt'
  | 'lastBackupError'
  /** `GitHubErrorKind` for the failure above, when it came from GitHub at all. */
  | 'lastBackupErrorKind'
  /** A local state-cache write that failed. Separate: a good push must not clear it. */
  | 'lastStateError'
  | 'theme'
  | 'skippedContextPrompt'
  /**
   * The Claude API key. Device-local on purpose: `meta` is the one store that
   * is never journalled, so the key cannot reach the data repo.
   */
  | 'claudeApiKey'
  /**
   * The read-only PAT for the mirror repos. A different grant from `token`,
   * and kept apart from it for that reason: clearing one must not silently
   * disarm the other. One token now selects both mirrors; the name predates
   * the second and is kept so no device has to re-enter the PAT.
   */
  | 'newslettersToken'
  /**
   * Per-mirror sync bookkeeping, one set per repo in `GitReadRepo`.
   *
   * `headSha` is the commit the last completed sync saw — the whole freshness
   * check. `fetchedAt` is when that sync completed, epoch ms. `tree` is that
   * commit's tree trimmed to path/sha/size, cached because a mirror has to
   * describe itself with no network at all and the file list is the tree's to
   * give.
   */
  | `gitread:${GitReadRepo}:headSha`
  | `gitread:${GitReadRepo}:fetchedAt`
  | `gitread:${GitReadRepo}:tree`

/** A cached journal file as fetched from the data repo. */
export type JournalCacheRecord = {
  path: string
  text: string
  sha: string | null
  fetchedAt: number
}

/**
 * A cached file from a mirror repo. `sha` is the blob sha the content came
 * from, which is what the next sync diffs against — never a commit sha.
 *
 * `path` is the plain repo path in and out. The repo namespace belongs to the
 * key alone and is added and stripped by the accessors below, so no caller
 * has to remember to apply it — and none can forget.
 */
export type ContentCacheRecord = {
  path: string
  text: string
  sha: string
  fetchedAt: number
}

/**
 * The minimum an outbox row must carry: an id to key it by and a seq to drain
 * it in order. Journal events satisfy this structurally; the full event type
 * lives in journal.ts and is deliberately not imported here.
 */
export type OutboxRecord = {
  id: string
  seq: number
}

// --- errors ----------------------------------------------------------------

/** Why a call failed, for callers that need to branch rather than just report. */
export type DbErrorKind = 'invalidRecord' | 'transaction' | 'open' | 'unsupported'

/**
 * Every rejection this module raises itself. IndexedDB hands back `null` at
 * least as often as it hands back a reason, so the one thing this guarantees
 * is a non-empty `message`.
 */
export class DbError extends Error {
  kind: DbErrorKind

  constructor(kind: DbErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DbError'
    this.kind = kind
  }
}

/** Readable text for whatever IndexedDB gave us, which is frequently nothing. */
function reasonText(reason: unknown): string {
  if (typeof reason === 'string') return reason
  if (reason === null || reason === undefined) return ''
  const like = reason as { name?: unknown; message?: unknown }
  const name = typeof like.name === 'string' ? like.name : ''
  const message = typeof like.message === 'string' ? like.message : ''
  if (name.length > 0 && message.length > 0) return `${name}: ${message}`
  return name.length > 0 ? name : message
}

function dbError(kind: DbErrorKind, what: string, reason?: unknown): DbError {
  const detail = reasonText(reason)
  return new DbError(
    kind,
    detail.length > 0 ? `${what}: ${detail}` : `${what}: IndexedDB reported no reason`,
    { cause: reason ?? undefined }
  )
}

// --- connection ------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null
let openHandle: IDBDatabase | null = null

/**
 * Drops the cached promise when the connection behind it is dead. Guarded on
 * identity so a reopen that has already happened is never clobbered.
 */
function invalidate(dead: IDBDatabase): void {
  if (openHandle !== dead) return
  openHandle = null
  dbPromise = null
}

/**
 * v2 → v3: every `contentCache` key gains its repo namespace.
 *
 * A v2 database only ever held newsletters files, so every bare key is one of
 * those.
 *
 * The record's `path` field *is* the key (the store's keyPath), which is why
 * this is a delete and a put rather than `cursor.update()`: updating a record
 * to a value whose key path evaluates to a different key is a DataError, and
 * it aborts the whole upgrade transaction.
 *
 * A cursor rather than getAll/putAll because this runs inside the upgrade the
 * app is blocked on: the records stream past one at a time rather than the
 * whole corpus being materialised at once on a phone. Putting a record back
 * under a name that sorts after the cursor means the cursor can reach it
 * again — `isNamespaced` is what makes that a no-op rather than a double
 * prefix.
 */
function upgradeContentCacheKeys(tx: IDBTransaction, oldVersion: number): void {
  if (oldVersion === 0 || oldVersion >= 3) return
  const store = tx.objectStore(CONTENT_CACHE)
  const req = store.openCursor()
  req.onsuccess = () => {
    const cursor = req.result
    if (!cursor) return
    const record = cursor.value as ContentCacheRecord
    if (record && typeof record.path === 'string' && !isNamespaced(record.path)) {
      cursor.delete()
      store.put({ ...record, path: cacheKey('newsletters', record.path) })
    }
    cursor.continue()
  }

  // The v2 sync scalars are dropped rather than renamed. What they buy is one
  // tree fetch, on one open, and carrying a key the type no longer admits is
  // how a stale tree gets read back years later by a typo.
  const meta = tx.objectStore(META)
  for (const key of ['nlHeadSha', 'nlTree', 'nlTreeFetchedAt']) meta.delete(key)
}

/** Opens (and creates on first run) the database. Idempotent; caches the handle. */
export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (event) => {
        const db = req.result
        if (!db.objectStoreNames.contains(STATE)) {
          db.createObjectStore(STATE)
        }
        if (!db.objectStoreNames.contains(JOURNAL_CACHE)) {
          db.createObjectStore(JOURNAL_CACHE, { keyPath: 'path' })
        }
        if (!db.objectStoreNames.contains(OUTBOX)) {
          const outbox = db.createObjectStore(OUTBOX, { keyPath: 'id' })
          outbox.createIndex(BY_SEQ, 'seq', { unique: false })
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META)
        }
        // v2. Every store above is created only where absent, so a v1 database
        // arrives here with its four stores and their records untouched and
        // leaves with a fifth, empty one.
        if (!db.objectStoreNames.contains(CONTENT_CACHE)) {
          db.createObjectStore(CONTENT_CACHE, { keyPath: 'path' })
        }
        // v3. Keys in the content cache gain a repo namespace. Only that: the
        // text and the sha of every cached file are rewritten byte for byte,
        // under the key they will be read by from here on.
        if (req.transaction) upgradeContentCacheKeys(req.transaction, event.oldVersion)
      }
      // Another tab is holding an older version open. Without this the promise
      // never settles and the app freezes with nothing to show for it.
      req.onblocked = () =>
        reject(
          dbError('open', 'another tab is holding an older version of the database open')
        )
      req.onsuccess = () => {
        const db = req.result
        // The connection can die out of band — storage pressure, or the user
        // clearing site data. Every transaction on a dead handle throws
        // synchronously, so it must not stay cached.
        db.onclose = () => invalidate(db)
        // Step aside so another tab's schema upgrade can proceed.
        db.onversionchange = () => {
          invalidate(db)
          db.close()
        }
        openHandle = db
        resolve(db)
      }
      req.onerror = () => reject(dbError('open', 'could not open the database', req.error))
    })
    // A failed open must not poison the cache for the rest of the session.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null
    })
    dbPromise = opening
  }
  return dbPromise
}

/** Closes the cached handle. The next call to any accessor reopens. */
export async function closeDb(): Promise<void> {
  const pending = dbPromise
  dbPromise = null
  openHandle = null
  if (!pending) return
  const db = await pending.catch(() => null)
  db?.close()
}

// --- request / transaction plumbing ---------------------------------------

/**
 * Asks for `strict` durability where the engine takes it. Some engines reject
 * the options argument outright, and a plain transaction is still correct —
 * just not flushed to disk on commit — so fall back rather than throw.
 */
function startTx(
  db: IDBDatabase,
  store: StoreName,
  mode: IDBTransactionMode,
  strict: boolean
): IDBTransaction {
  if (strict) {
    try {
      return db.transaction(store, mode, { durability: 'strict' })
    } catch {
      // Unsupported argument, or a dead handle — the plain call below decides
      // which, and rethrows if the handle is the problem.
    }
  }
  return db.transaction(store, mode)
}

/**
 * Starts a transaction, reopening once if the cached handle turned out to be
 * dead. `db.transaction()` throws synchronously on a closed connection, and
 * the connection can die in the gap between `await openDb()` and this call.
 */
async function beginTx(
  store: StoreName,
  mode: IDBTransactionMode,
  strict = false
): Promise<IDBTransaction> {
  let last: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const db = await openDb()
    try {
      return startTx(db, store, mode, strict)
    } catch (error) {
      last = error
      invalidate(db)
    }
  }
  throw dbError('open', `could not start a ${mode} transaction on "${store}"`, last)
}

function requestDone<T>(req: IDBRequest<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(dbError('transaction', `reading "${what}" failed`, req.error))
  })
}

function txDone(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let requestError: unknown = null
    tx.oncomplete = () => resolve()
    tx.onerror = (event) => {
      // `tx.error` is still null while the error event propagates, so
      // rejecting here would throw the reason away. Keep the failing request's
      // error and let the abort that always follows settle the promise.
      const source = event.target as { error?: unknown } | null
      requestError = source?.error ?? requestError
    }
    tx.onabort = () =>
      reject(dbError('transaction', `transaction on "${what}" failed`, tx.error ?? requestError))
  })
}

function abortQuietly(tx: IDBTransaction): void {
  try {
    tx.abort()
  } catch {
    // Already finished; there is nothing left to roll back.
  }
}

async function read<T>(store: StoreName, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = await beginTx(store, 'readonly')
  return requestDone(run(tx.objectStore(store)), store)
}

/** Resolves only once the transaction has committed, never merely on request success. */
async function write(store: StoreName, run: (s: IDBObjectStore) => void): Promise<void> {
  const tx = await beginTx(store, 'readwrite')
  const committed = txDone(tx, store)
  try {
    run(tx.objectStore(store))
  } catch (error) {
    // A throw part-way through a batch would otherwise commit the records
    // written before it and drop the rest. Abort so the batch is
    // all-or-nothing, and report the real cause rather than the AbortError.
    committed.catch(() => undefined)
    abortQuietly(tx)
    throw error instanceof Error
      ? error
      : dbError('transaction', `writing to "${store}" failed`, error)
  }
  return committed
}

// --- state -----------------------------------------------------------------

/** The folded state, or undefined before the first fold. */
export function getState<T = unknown>(): Promise<T | undefined> {
  return read<T | undefined>(STATE, (s) => s.get(STATE_KEY))
}

export function setState(state: unknown): Promise<void> {
  return write(STATE, (s) => {
    s.put(state, STATE_KEY)
  })
}

// --- meta ------------------------------------------------------------------

export function getMeta<T>(key: MetaKey, fallback: T): Promise<T>
export function getMeta<T>(key: MetaKey): Promise<T | undefined>
export async function getMeta<T>(key: MetaKey, fallback?: T): Promise<T | undefined> {
  const value = await read<T | undefined>(META, (s) => s.get(key))
  return value === undefined ? fallback : value
}

export function setMeta(key: MetaKey, value: unknown): Promise<void> {
  return write(META, (s) => {
    s.put(value, key)
  })
}

export function deleteMeta(key: MetaKey): Promise<void> {
  return write(META, (s) => {
    s.delete(key)
  })
}

/**
 * A fresh device id. `crypto.randomUUID` is secure-context-only and is simply
 * absent when the PWA is opened over plain http on the LAN — which is how the
 * phone reaches the dev server — so fall back to `getRandomValues`, which is
 * not gated on a secure context. Same alphabet, same length either way.
 */
function newDeviceId(): string {
  const api: Crypto | undefined = globalThis.crypto
  if (api && typeof api.randomUUID === 'function') {
    return api.randomUUID().slice(0, DEVICE_ID_LENGTH)
  }
  if (api && typeof api.getRandomValues === 'function') {
    const bytes = api.getRandomValues(new Uint8Array(DEVICE_ID_LENGTH / 2))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  throw new DbError(
    'unsupported',
    'this browser exposes no crypto random source, so no device id can be minted'
  )
}

/**
 * This device's short id, created on first call and stable thereafter.
 * Read and create share one transaction so two concurrent callers cannot
 * mint two different ids.
 */
export async function getDeviceId(): Promise<string> {
  const tx = await beginTx(META, 'readwrite', true)
  const store = tx.objectStore(META)
  let deviceId = ''
  let failure: Error | null = null
  const req = store.get('deviceId')
  req.onsuccess = () => {
    const existing: unknown = req.result
    if (typeof existing === 'string' && existing.length > 0) {
      deviceId = existing
      return
    }
    try {
      deviceId = newDeviceId()
      store.put(deviceId, 'deviceId')
    } catch (error) {
      // A throw inside onsuccess reaches the caller as a bare, message-less
      // AbortError. Carry the real reason out by hand.
      failure =
        error instanceof Error
          ? error
          : dbError('unsupported', 'could not mint a device id', error)
      abortQuietly(tx)
    }
  }
  try {
    await txDone(tx, META)
  } catch (error) {
    if (failure !== null) throw failure
    throw error
  }
  return deviceId
}

/**
 * The next per-device sequence number.
 *
 * Durability rule: the incremented counter is committed BEFORE the number is
 * handed out. A crash between handing out a seq and persisting it would let
 * two events share a seq and silently corrupt fold order — so we resolve on
 * transaction completion, not on request success. Read and write share one
 * readwrite transaction, which IndexedDB serialises against concurrent ones.
 *
 * `complete` means committed to the database, not flushed to disk: Chromium
 * defaults IndexedDB to relaxed durability, where a power cut can roll the
 * counter back and hand the same seq out twice. Asking for `strict` closes
 * that window on engines that support it; where they do not, the guarantee is
 * only as strong as the engine's default flush.
 */
export async function nextSeq(): Promise<number> {
  const tx = await beginTx(META, 'readwrite', true)
  const store = tx.objectStore(META)
  let next = 0
  const req = store.get('seq')
  req.onsuccess = () => {
    const current: unknown = req.result
    next = (typeof current === 'number' ? current : 0) + 1
    store.put(next, 'seq')
  }
  await txDone(tx, META)
  return next
}

// --- token -----------------------------------------------------------------

export function getToken(): Promise<string | undefined> {
  return getMeta<string>('token')
}

export function setToken(token: string): Promise<void> {
  return setMeta('token', token)
}

export function clearToken(): Promise<void> {
  return deleteMeta('token')
}

// --- outbox ----------------------------------------------------------------

/**
 * An outbox row needs a usable primary key and a usable index key. IndexedDB
 * indexes are sparse: a row whose `seq` is not a valid key is stored but never
 * indexed, so `peekOutbox` never sees it, `outboxSize` keeps counting it, and
 * it is never pushed and never removed — the unpushed counter sticks forever.
 */
function assertQueueable(record: unknown, index: number): void {
  const candidate = record as Partial<OutboxRecord> | null | undefined
  const id = candidate?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new DbError(
      'invalidRecord',
      `outbox record at index ${index} has no id; nothing was queued`
    )
  }
  const seq = candidate?.seq
  if (typeof seq !== 'number' || !Number.isFinite(seq)) {
    throw new DbError(
      'invalidRecord',
      `outbox record "${id}" has a seq that is not a finite number; nothing was queued`
    )
  }
}

export async function enqueue<T extends OutboxRecord>(events: readonly T[]): Promise<void> {
  // The whole batch is checked before a transaction opens, so a bad record
  // commits nothing at all.
  events.forEach(assertQueueable)
  return write(OUTBOX, (s) => {
    for (const event of events) s.put(event)
  })
}

/** Unpushed events in `seq` order, oldest first. */
export function peekOutbox<T extends OutboxRecord = OutboxRecord>(limit?: number): Promise<T[]> {
  // `getAll(query, 0)` means "no limit" to IndexedDB. A drain loop asking for
  // none of its remaining budget must get none, not the entire outbox.
  if (limit !== undefined && limit <= 0) return Promise.resolve([])
  return read<T[]>(OUTBOX, (s) => s.index(BY_SEQ).getAll(null, limit) as IDBRequest<T[]>)
}

export function removeFromOutbox(ids: readonly string[]): Promise<void> {
  return write(OUTBOX, (s) => {
    for (const id of ids) s.delete(id)
  })
}

export function outboxSize(): Promise<number> {
  return read<number>(OUTBOX, (s) => s.count())
}

// --- journal cache ---------------------------------------------------------

export function getCachedFile(path: string): Promise<JournalCacheRecord | undefined> {
  return read<JournalCacheRecord | undefined>(JOURNAL_CACHE, (s) => s.get(path))
}

export function putCachedFile(record: JournalCacheRecord): Promise<void> {
  return write(JOURNAL_CACHE, (s) => {
    s.put(record)
  })
}

export function allCachedFiles(): Promise<JournalCacheRecord[]> {
  return read<JournalCacheRecord[]>(JOURNAL_CACHE, (s) => s.getAll())
}

// --- mirror content cache --------------------------------------------------

/**
 * The key one mirror's file is stored under: `<repo>:<path>`.
 *
 * Two mirrors share one store, and `events.json` is a plausible path in either
 * of them. Without the namespace the second repo to sync would overwrite the
 * first's file and then diff its own sha against it forever.
 */
function cacheKey(repo: GitReadRepo, path: string): string {
  return `${repo}${CACHE_NAMESPACE_SEPARATOR}${path}`
}

/** Whether a stored key already carries a namespace. Only the upgrade asks. */
function isNamespaced(key: string): boolean {
  const cut = key.indexOf(CACHE_NAMESPACE_SEPARATOR)
  if (cut === -1) return false
  const head = key.slice(0, cut)
  return head === 'newsletters' || head === 'calendar-data'
}

/** Strips the namespace a key was written with, restoring the repo path. */
function cachePath(repo: GitReadRepo, key: string): string {
  const prefix = cacheKey(repo, '')
  return key.startsWith(prefix) ? key.slice(prefix.length) : key
}

export async function getCachedContent(
  repo: GitReadRepo,
  path: string
): Promise<ContentCacheRecord | undefined> {
  const record = await read<ContentCacheRecord | undefined>(CONTENT_CACHE, (s) =>
    s.get(cacheKey(repo, path))
  )
  return record ? { ...record, path } : undefined
}

export function putCachedContent(
  repo: GitReadRepo,
  record: ContentCacheRecord
): Promise<void> {
  return write(CONTENT_CACHE, (s) => {
    s.put({ ...record, path: cacheKey(repo, record.path) })
  })
}

/**
 * One mirror's cached paths and the shas they hold, and nothing else.
 *
 * A cursor rather than `getAll` on purpose: the answer this is asked for is a
 * few kilobytes of shas, while the store it reads can hold megabytes of prose
 * once raw entries have been opened. `getAll` would materialise all of it at
 * once to throw the text away.
 */
export async function cachedContentShas(repo: GitReadRepo): Promise<Map<string, string>> {
  const tx = await beginTx(CONTENT_CACHE, 'readonly')
  const prefix = cacheKey(repo, '')
  const req = tx.objectStore(CONTENT_CACHE).openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`))
  const shas = new Map<string, string>()
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) {
        resolve(shas)
        return
      }
      const record = cursor.value as ContentCacheRecord
      if (record && typeof record.path === 'string' && typeof record.sha === 'string') {
        shas.set(cachePath(repo, record.path), record.sha)
      }
      cursor.continue()
    }
    req.onerror = () =>
      reject(dbError('transaction', `reading "${CONTENT_CACHE}" failed`, req.error))
  })
}

// --- persistence -----------------------------------------------------------

/**
 * Asks the browser to keep this origin's storage across eviction pressure.
 * Returns false rather than throwing where the API is missing (Safari before
 * 15.2, older WebViews) or where the request rejects.
 */
export async function requestPersistence(): Promise<boolean> {
  const storage: StorageManager | undefined = navigator.storage
  if (!storage || typeof storage.persist !== 'function') return false
  try {
    return await storage.persist()
  } catch {
    return false
  }
}
