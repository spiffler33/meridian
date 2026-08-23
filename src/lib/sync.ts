/**
 * Background sync between the local IndexedDB copy and the GitHub data repo.
 *
 * The app never waits on this. Reads are served from IndexedDB; this module
 * pulls newer journal files down and pushes queued events up, on triggers that
 * happen to be good moments rather than on a schedule the owner can feel.
 *
 * Two rules shape every path below:
 *   - An un-configured device is not an error. No token means no network, and
 *     no complaint.
 *   - A failed push leaves the outbox exactly as it found it, minus only the
 *     events GitHub actually accepted, and never advances `lastBackupAt`.
 */

import {
  allCachedFiles,
  deleteMeta,
  getCachedFile,
  getState,
  getToken,
  peekOutbox,
  putCachedFile,
  removeFromOutbox,
  setMeta,
} from './db'
import type { OutboxRecord } from './db'
import { appendLines, getFile, GitHubError, listJournal } from './github'
import type { GitHubErrorKind } from './github'
import { resetSession } from './entities'
import type { JournalEvent } from './journal'

/** Matches the directory `listJournal` reads; journal paths are built here too. */
const JOURNAL_DIR = 'journal'
const JOURNAL_EXTENSION = 'jsonl'

/** How long after the last edit a push is attempted. */
export const FLUSH_DEBOUNCE_MS = 5_000

// ============================================================================
// Months
// ============================================================================

/**
 * `YYYY-MM` for an epoch timestamp, in UTC.
 *
 * UTC rather than local time so the month a device writes into and the month
 * another device asks for are the same string regardless of where either one
 * is. The fold does not care which file an event lives in; only the read rule
 * below does, and it must agree with the write rule.
 */
function monthOf(epochMs: number): string {
  const at = new Date(epochMs)
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The current month and the one before it. Handles the January rollover. */
function recentMonths(nowMs: number): string[] {
  const at = new Date(nowMs)
  const previous = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1)
  return [monthOf(nowMs), monthOf(previous)]
}

/**
 * The file an event is appended to: the month it is being written in, and the
 * device writing it.
 *
 * Deliberately NOT the event's own `ts`. A backlog that drains weeks late
 * would otherwise land in a month no warm device ever fetches again, and the
 * edit would be invisible everywhere until a cold restore. The event carries
 * its own `ts` inside the line and the fold orders by that, so history stays
 * correct wherever the line physically sits.
 */
function journalPathFor(device: string, appendedAtMs: number): string {
  return `${JOURNAL_DIR}/${monthOf(appendedAtMs)}.${device}.${JOURNAL_EXTENSION}`
}

/**
 * Which failures are worth abandoning the rest of the flush for.
 *
 * A bad token, a dead network and a rate limit are properties of the whole
 * connection: the next group would hit the same wall. Everything else belongs
 * to one path — a single journal file over 1 MB must not wedge every other
 * file behind it forever.
 */
const GLOBAL_FAILURE_KINDS: GitHubErrorKind[] = ['auth', 'network', 'ratelimit']

function isGlobalFailure(error: unknown): boolean {
  return error instanceof GitHubError && GLOBAL_FAILURE_KINDS.includes(error.kind)
}

/**
 * Record why the push failed, best effort.
 *
 * `lastBackupError` means "the last push to GitHub failed" and nothing else.
 * The state-cache failure path in entities.ts owns its own key, so a clean
 * push here can clear this one without erasing a signal it did not cause.
 */
async function noteFlushFailure(detail: string, kind: GitHubErrorKind | null): Promise<void> {
  try {
    await setMeta('lastBackupError', detail)
    // The kind is what tells the red state apart: a rate limit must never send
    // the owner off to revoke a perfectly good token. A failure that never
    // reached GitHub has no kind, and leaves the key absent rather than
    // carrying a stale one forward.
    if (kind === null) await deleteMeta('lastBackupErrorKind')
    else await setMeta('lastBackupErrorKind', kind)
  } catch {
    // The note lives in the store that just refused the write. There is
    // nowhere left to put it, and the caller is already returning the reason.
  }
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  const text = String(error)
  return text.length > 0 ? text : 'the push failed and reported no reason'
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Push and pull share one queue, and never overlap.
 *
 * Run concurrently they interleave badly: the pull reads the remote file
 * before the push appends to it, the push lands and drains the outbox, then
 * the pull writes the stale text into the cache and drops the memoised
 * session. The edit the owner just made vanishes from the view until the next
 * foreground. Every entry point below goes through here instead.
 */
let syncQueue: Promise<unknown> = Promise.resolve()

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = syncQueue.then(work)
  // The queue must never carry a rejection forward, or one failure poisons
  // every turn after it. The caller still sees `next` exactly as it settled.
  syncQueue = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

// ============================================================================
// Pull
// ============================================================================

export interface SyncDownResult {
  /** True when the device had nothing cached and every listed file was wanted. */
  cold: boolean
  /** How many files the remote listed. */
  listed: number
  /** How many were actually downloaded (the rest were already cached at that sha). */
  fetched: number
}

/**
 * Fetch journal files into the local cache.
 *
 * COLD — nothing folded locally, or nothing cached — takes every file the
 * remote lists. The month window below would silently lose everything older
 * than two months on a fresh device, which is exactly the restore drill.
 *
 * WARM — the device already has a picture — takes only the current and
 * previous month, for every device. Older months cannot change: a journal is
 * append-only and each device only ever appends to its own current month.
 *
 * Returns null when no token is configured. Throws whatever `github.ts`
 * throws; the caller decides whether the owner needs to hear about it.
 */
export function syncDown(): Promise<SyncDownResult | null> {
  if (downInFlight === null) {
    const attempt = serialized(runSyncDown)
    downInFlight = attempt
    const release = () => {
      if (downInFlight === attempt) downInFlight = null
    }
    attempt.then(release, release)
  }
  return downInFlight
}

let downInFlight: Promise<SyncDownResult | null> | null = null

async function runSyncDown(): Promise<SyncDownResult | null> {
  const token = await getToken()
  if (token === undefined || token.length === 0) return null

  const [state, cached] = await Promise.all([getState(), allCachedFiles()])
  const cold = state === undefined || cached.length === 0

  const listed = await listJournal(token)
  const months = recentMonths(Date.now())
  const wanted = cold ? listed : listed.filter((file) => months.includes(file.month))

  let fetched = 0
  try {
    for (const file of wanted) {
      // The remote sha is in the listing, so an unchanged file costs nothing.
      const existing = await getCachedFile(file.path)
      if (existing !== undefined && existing.sha === file.sha) continue

      const content = await getFile(token, file.path)
      // Deleted between the listing and the read. Nothing to cache.
      if (content === null) continue

      await putCachedFile({
        path: file.path,
        text: content.text,
        sha: content.sha,
        fetchedAt: Date.now(),
      })
      fetched += 1
    }
  } catch (error) {
    // Files that did land are invisible to every reader until the memoised
    // session is dropped, so drop it before the failure propagates.
    if (fetched > 0) resetSession()
    throw error
  }

  // Without this the session folded before the fetch serves this tab for the
  // rest of its life, and the owner sees pre-sync data until a reload.
  resetSession()
  return { cold, listed: listed.length, fetched }
}

// ============================================================================
// Push
// ============================================================================

export interface FlushResult {
  /** Events GitHub accepted and that are no longer queued. */
  pushed: number
  /** Events still in the outbox, waiting for the next attempt. */
  remaining: number
  /** Why the flush stopped early, or null if it did not. */
  error: string | null
}

/**
 * Drain the outbox into the journal.
 *
 * Events are grouped by the file they belong in — the appending device, and the
 * month it is being appended IN, not the month the event happened. A device only
 * ever writes its own current-month file, which is what keeps the warm read
 * window (current + previous) sufficient; deriving the path from the event's own
 * ts would file a delayed backlog into a month nothing re-reads.
 *
 * A group that hits a GLOBAL wall — a bad token, a rate limit, no network —
 * stops the flush, because that wall is still there for the next group. A
 * failure specific to one path (an oversized file, say) lets the remaining
 * groups through, so one stuck file cannot wedge the whole outbox. Either way
 * every event not actually written stays queued for the next attempt.
 *
 * Returns null when no token is configured.
 */
export function flushOutbox(): Promise<FlushResult | null> {
  if (flushInFlight === null) {
    const attempt = serialized(runFlush)
    flushInFlight = attempt
    const release = () => {
      if (flushInFlight === attempt) flushInFlight = null
    }
    attempt.then(release, release)
  }
  return flushInFlight
}

let flushInFlight: Promise<FlushResult | null> | null = null

async function runFlush(): Promise<FlushResult | null> {
  let token: string | undefined
  let events: (JournalEvent & OutboxRecord)[]
  try {
    token = await getToken()
    if (token === undefined || token.length === 0) return null
    events = await peekOutbox<JournalEvent & OutboxRecord>()
  } catch (error) {
    // Nothing has been pushed, but the owner's only two signals would both
    // read "nothing happened" unless this is written down.
    const detail = `the outbox could not be read: ${describe(error)}`
    await noteFlushFailure(detail, null)
    return { pushed: 0, remaining: 0, error: detail }
  }

  // Nothing queued is not a backup. `lastBackupAt` means "the last time events
  // reached GitHub", so leave it where it is.
  if (events.length === 0) return { pushed: 0, remaining: 0, error: null }

  const appendedAt = Date.now()
  const groups = new Map<string, { lines: string[]; ids: string[] }>()
  for (const event of events) {
    const path = journalPathFor(event.device, appendedAt)
    let group = groups.get(path)
    if (group === undefined) {
      group = { lines: [], ids: [] }
      groups.set(path, group)
    }
    // peekOutbox hands events back in seq order, so each group is already in
    // the order it was recorded.
    group.lines.push(JSON.stringify(event))
    group.ids.push(event.id)
  }

  const written: string[] = []
  let failure: string | null = null
  let failureKind: GitHubErrorKind | null = null
  for (const [path, group] of groups) {
    try {
      await appendLines(token, path, group.lines)
      written.push(...group.ids)
    } catch (error) {
      // The first reason is the one worth reporting; anything after it may be
      // a knock-on.
      if (failure === null) {
        failure = describe(error)
        failureKind = error instanceof GitHubError ? error.kind : null
      }
      if (isGlobalFailure(error)) break
    }
  }

  try {
    // Only the ids GitHub actually took. A re-push of a duplicate would be
    // deduped by the fold anyway, so erring toward keeping them is safe.
    if (written.length > 0) await removeFromOutbox(written)

    if (failure === null) {
      await setMeta('lastBackupAt', Date.now())
      await deleteMeta('lastBackupError')
      await deleteMeta('lastBackupErrorKind')
    }
  } catch (error) {
    // The events reached GitHub but the local store did not record it: they
    // are still queued and `lastBackupAt` is frozen. Without a note here every
    // signal the owner has says the push never happened.
    if (failure === null) {
      failure = `the push reached GitHub but the local store did not record it: ${describe(error)}`
      failureKind = null
    }
  }

  if (failure !== null) await noteFlushFailure(failure, failureKind)

  return { pushed: written.length, remaining: events.length - written.length, error: failure }
}

// ============================================================================
// Triggers
// ============================================================================

let flushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Push soon, but not on every keystroke. Each call pushes the attempt out
 * again, so a burst of edits produces one request once the burst stops.
 */
export function scheduleFlush(): void {
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    // The reason already went into `lastBackupError`; a timer callback has
    // nobody to rethrow to.
    void flushOutbox().catch(() => undefined)
  }, FLUSH_DEBOUNCE_MS)
}

export interface SyncTriggerOptions {
  /** Called after a pull that actually changed the local cache. */
  onSynced?: () => void
}

/**
 * Wire the moments worth syncing on: the tab being hidden or unloaded (the
 * last chance to push before it may be discarded), and the app coming back to
 * the foreground (the moment another device's edits are worth having).
 *
 * Returns a teardown that removes every listener and cancels a pending flush.
 */
export function installSyncTriggers(options: SyncTriggerOptions = {}): () => void {
  const { onSynced } = options

  const push = () => {
    void flushOutbox().catch(() => undefined)
  }

  const pull = () => {
    void syncDown().then(
      (result) => {
        if (result !== null && result.fetched > 0 && onSynced) onSynced()
      },
      () => undefined
    )
  }

  // Push before pull, always. Both go on the shared queue, so the pull reads a
  // remote that already contains whatever this device had waiting.
  const onVisibilityChange = () => {
    push()
    if (document.visibilityState === 'visible') pull()
  }

  // A page being unloaded cannot await anything; this is best-effort, and what
  // does not make it out stays in the outbox for the next open.
  const onPageHide = () => {
    push()
  }

  const onFocus = () => {
    push()
    pull()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('focus', onFocus)

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('focus', onFocus)
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }
}
