import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `resetSession` is wrapped rather than replaced: the count proves the call
 * happened, and the passthrough keeps the behavioural half of the same test
 * honest — after a pull, a re-hydrate must actually see the new events.
 */
const spies = vi.hoisted(() => ({ resetSession: 0 }))

vi.mock('./entities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./entities')>()
  return {
    ...actual,
    resetSession: () => {
      spies.resetSession += 1
      actual.resetSession()
    },
  }
})

/**
 * Faults injected into the local store, so the paths that run AFTER GitHub has
 * accepted a push can be made to fail on demand.
 */
const dbFaults = vi.hoisted(() => ({ getToken: false, removeFromOutbox: false }))

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    getToken: () => {
      if (dbFaults.getToken) return Promise.reject(new Error('the store will not open'))
      return actual.getToken()
    },
    removeFromOutbox: (ids: string[]) => {
      if (dbFaults.removeFromOutbox) return Promise.reject(new Error('the quota is exhausted'))
      return actual.removeFromOutbox(ids)
    },
  }
})

/** Counts the data-layer calls the React test needs to see exactly once. */
const dataCalls = vi.hoisted(() => ({ getHabits: 0, toggleCompletion: 0 }))

vi.mock('../services/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/data')>()
  return {
    ...actual,
    getHabits: (...args: Parameters<typeof actual.getHabits>) => {
      dataCalls.getHabits += 1
      return actual.getHabits(...args)
    },
    toggleCompletion: (...args: Parameters<typeof actual.toggleCompletion>) => {
      dataCalls.toggleCompletion += 1
      return actual.toggleCompletion(...args)
    },
  }
})

import { GITHUB_API_BASE, GITHUB_OWNER, GITHUB_REPO } from './github'
import {
  closeDb,
  enqueue,
  getCachedFile,
  getMeta,
  getState,
  outboxSize,
  peekOutbox,
  putCachedFile,
  setMeta,
  setState,
  setToken,
} from './db'
import { currentState, hydrate, resetSession } from './entities'
import { flushOutbox, FLUSH_DEBOUNCE_MS, installSyncTriggers, scheduleFlush, syncDown } from './sync'

const TOKEN = 'test-token-not-a-real-pat'
const REPO_BASE = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}`

// ============================================================================
// Months, derived independently of the module under test
// ============================================================================

/** `YYYY-MM` in UTC, via a different route than sync.ts takes to the same answer. */
function utcMonth(at: Date): string {
  return at.toISOString().slice(0, 7)
}

const NOW = new Date()
const CURRENT_MONTH = utcMonth(NOW)
const PREVIOUS_MONTH = utcMonth(new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 1)))
/** Comfortably outside the two-month window, whatever today is. */
const OLD_MONTH = '2026-01'

// ============================================================================
// UTF-8 base64 (mirrors github.ts, so the fake speaks the same wire format)
// ============================================================================

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decode(data: string): string {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// ============================================================================
// Fake GitHub contents API
// ============================================================================

interface FetchInit {
  method?: string
  body?: string
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

interface RemoteOptions {
  /** path -> file text. Paths are repo-relative, e.g. `journal/2026-08.laptop.jsonl`. */
  files?: Record<string, string>
  /** Listed entries. Defaults to one per file. */
  listing?: Array<{ name: string; sha: string }> | null
  /**
   * Make every request take a real turn of the event loop. Two requests can
   * then genuinely be in flight at once, which is the only way `maxInFlight`
   * can tell overlapping work from work that merely started in the same tick.
   */
  slow?: boolean
}

function fakeGitHub(options: RemoteOptions = {}) {
  const files = new Map<string, { text: string; sha: string }>()
  let shaCount = 0
  const nextSha = () => {
    shaCount += 1
    return `sha${shaCount}`
  }
  for (const [path, text] of Object.entries(options.files ?? {})) {
    files.set(path, { text, sha: nextSha() })
  }

  const control = {
    gets: [] as string[],
    puts: [] as { path: string; text: string }[],
    /** Statuses forced onto upcoming PUTs, one shift per PUT. Null lets one through. */
    failPuts: [] as Array<number | null>,
    /** Paths whose GET is refused with a 500. */
    failGets: new Set<string>(),
    /** Every request in start order, as `METHOD path`. */
    log: [] as string[],
    /** Highest number of requests in flight at the same moment. */
    maxInFlight: 0,
    text: (path: string) => files.get(path)?.text,
  }
  let inFlight = 0

  function respond(method: string, path: string, body: Record<string, unknown> | null): Response {
    if (path === 'journal' && method === 'GET') {
      const listing =
        options.listing === undefined
          ? [...files.entries()].map(([full, file]) => ({
              name: full.slice('journal/'.length),
              sha: file.sha,
            }))
          : options.listing
      if (listing === null) return response(404, { message: 'Not Found' })
      return response(
        200,
        listing.map((entry) => ({
          name: entry.name,
          path: `journal/${entry.name}`,
          sha: entry.sha,
          type: 'file',
        }))
      )
    }

    if (method === 'GET') {
      control.gets.push(path)
      if (control.failGets.has(path)) return response(500, { message: 'forced' })
      const file = files.get(path)
      if (file === undefined) return response(404, { message: 'Not Found' })
      return response(200, { content: encode(file.text), encoding: 'base64', sha: file.sha })
    }

    if (method === 'PUT') {
      const forced = control.failPuts.shift()
      const text = decode(String(body?.content ?? ''))
      control.puts.push({ path, text })
      if (forced !== undefined && forced !== null) return response(forced, { message: 'forced' })
      const sha = nextSha()
      files.set(path, { text, sha })
      return response(200, { content: { sha } })
    }

    return response(405, { message: 'not implemented' })
  }

  const handler = async (input: string, init?: FetchInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    const suffix = input.slice(REPO_BASE.length)
    const path = suffix.startsWith('/contents/')
      ? decodeURIComponent(suffix.slice('/contents/'.length))
      : ''
    const body = init?.body === undefined ? null : (JSON.parse(init.body) as Record<string, unknown>)
    control.log.push(`${method} ${path}`)
    inFlight += 1
    control.maxInFlight = Math.max(control.maxInFlight, inFlight)
    try {
      if (options.slow === true) await new Promise((resolve) => setTimeout(resolve, 2))
      return respond(method, path, body)
    } finally {
      inFlight -= 1
    }
  }

  vi.stubGlobal('fetch', vi.fn(handler))
  return control
}

// ============================================================================
// Events
// ============================================================================

interface EventOptions {
  id: string
  seq: number
  device: string
  ts: number
  entityId?: string
}

function upsert(options: EventOptions) {
  return {
    id: options.id,
    seq: options.seq,
    device: options.device,
    ts: options.ts,
    entity: 'habit',
    entityId: options.entityId ?? options.id,
    type: 'upsert' as const,
    fields: { label: options.id },
  }
}

/** Epoch ms inside the given `YYYY-MM`, safely away from either boundary. */
function midMonth(month: string): number {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  return Date.UTC(year, index - 1, 15, 12)
}

/** Poll until `predicate` holds. Real timers only. */
async function until(predicate: () => boolean, label: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Give every already-queued sync a chance to finish. Real timers only. */
async function settle(ms = 150): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  // Zeroed after the reset, so the reset itself is not counted.
  resetSession()
  spies.resetSession = 0
  dataCalls.getHabits = 0
  dataCalls.toggleCompletion = 0
  dbFaults.getToken = false
  dbFaults.removeFromOutbox = false
})

afterEach(async () => {
  vi.useRealTimers()
  // Installing and immediately tearing down cancels any debounce a test left
  // pending, so it cannot fire against a database that no longer exists.
  installSyncTriggers()()
  vi.unstubAllGlobals()
  resetSession()
  await closeDb()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('meridian')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
    req.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'))
  })
})

// ============================================================================
// An un-configured device
// ============================================================================

describe('a device with no token', () => {
  it('pulls nothing, quietly', async () => {
    const remote = fakeGitHub({ files: { [`journal/${CURRENT_MONTH}.laptop.jsonl`]: '' } })

    await expect(syncDown()).resolves.toBeNull()

    expect(fetch).not.toHaveBeenCalled()
    expect(remote.gets).toEqual([])
    expect(spies.resetSession).toBe(0)
  })

  it('pushes nothing, keeps the outbox, and records no error', async () => {
    fakeGitHub()
    await enqueue([upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])

    await expect(flushOutbox()).resolves.toBeNull()

    expect(fetch).not.toHaveBeenCalled()
    expect(await outboxSize()).toBe(1)
    expect(await getMeta('lastBackupAt')).toBeUndefined()
    expect(await getMeta('lastBackupError')).toBeUndefined()
  })
})

// ============================================================================
// Pull
// ============================================================================

describe('pulling the journal down', () => {
  const paths = {
    old: `journal/${OLD_MONTH}.seed.jsonl`,
    previous: `journal/${PREVIOUS_MONTH}.phone.jsonl`,
    current: `journal/${CURRENT_MONTH}.laptop.jsonl`,
    currentOther: `journal/${CURRENT_MONTH}.phone.jsonl`,
  }

  function remoteWithEverything() {
    return fakeGitHub({
      files: {
        [paths.old]: `${JSON.stringify(upsert({ id: 'old', seq: 1, device: 'seed', ts: midMonth(OLD_MONTH) }))}\n`,
        [paths.previous]: `${JSON.stringify(upsert({ id: 'prev', seq: 1, device: 'phone', ts: midMonth(PREVIOUS_MONTH) }))}\n`,
        [paths.current]: `${JSON.stringify(upsert({ id: 'cur', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) }))}\n`,
        [paths.currentOther]: `${JSON.stringify(upsert({ id: 'cur2', seq: 1, device: 'phone', ts: midMonth(CURRENT_MONTH) }))}\n`,
      },
    })
  }

  it('fetches every listed file on a cold restore', async () => {
    await setToken(TOKEN)
    const remote = remoteWithEverything()

    const result = await syncDown()

    expect(result).toEqual({ cold: true, listed: 4, fetched: 4 })
    expect([...remote.gets].sort()).toEqual(
      [paths.old, paths.previous, paths.current, paths.currentOther].sort()
    )
  })

  it('fetches only the current and previous month once the device is warm', async () => {
    await setToken(TOKEN)
    // Warm: something folded, and something cached. The cached file is the old
    // month with a stale sha, so a broken month filter would show up as a fetch.
    await setState({})
    await putCachedFile({ path: paths.old, text: '', sha: 'stale', fetchedAt: 1 })
    const remote = remoteWithEverything()

    const result = await syncDown()

    expect(result).toEqual({ cold: false, listed: 4, fetched: 3 })
    expect([...remote.gets].sort()).toEqual([paths.previous, paths.current, paths.currentOther].sort())
    expect(remote.gets).not.toContain(paths.old)
  })

  it('treats a device with folded state but an empty cache as cold', async () => {
    await setToken(TOKEN)
    await setState({})
    const remote = remoteWithEverything()

    const result = await syncDown()

    expect(result?.cold).toBe(true)
    expect(remote.gets).toContain(paths.old)
  })

  it('skips a file whose cached sha already matches the listing', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub({
      files: {
        [paths.current]: 'line\n',
        [paths.currentOther]: 'line\n',
      },
    })
    // sha1 is what the fake minted for the first file it was handed.
    await setState({})
    await putCachedFile({ path: paths.current, text: 'line\n', sha: 'sha1', fetchedAt: 1 })

    const result = await syncDown()

    expect(result?.fetched).toBe(1)
    expect(remote.gets).toEqual([paths.currentOther])
  })

  it('resets the session so the fetched events are visible, not the pre-fetch fold', async () => {
    await setToken(TOKEN)
    // A session folded before the fetch: nothing on this device yet.
    await hydrate()
    expect(currentState().habit).toBeUndefined()

    remoteWithEverything()
    await syncDown()

    expect(spies.resetSession).toBe(1)

    // The behavioural half: without the reset, hydrate() would hand back its
    // memoised promise and this would still be empty.
    await hydrate()
    expect(Object.keys(currentState().habit ?? {}).sort()).toEqual(['cur', 'cur2', 'old', 'prev'])
  })

  it('hands two overlapping callers the one pull, not a second empty one', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub({
      files: { [paths.current]: 'line\n', [paths.currentOther]: 'line\n' },
      slow: true,
    })

    const [first, second] = await Promise.all([syncDown(), syncDown()])

    expect(second).toBe(first)
    expect(second?.fetched).toBe(2)
    // Each file read once, not once per caller.
    expect([...remote.gets].sort()).toEqual([paths.current, paths.currentOther].sort())
  })

  it('drops the memoised session for the files that did land before the failure', async () => {
    await setToken(TOKEN)
    const remote = remoteWithEverything()
    // The first wanted file lands; a later one is refused, so the fetch throws
    // with some files already written into the cache.
    remote.failGets.add(paths.currentOther)
    await hydrate()

    await expect(syncDown()).rejects.toThrow()

    // Without this, the files that did land stay invisible for the rest of the
    // tab's life: the pre-fetch fold is still memoised.
    expect(spies.resetSession).toBe(1)
    await hydrate()
    expect(Object.keys(currentState().habit ?? {}).length).toBeGreaterThan(0)
  })

  it('caches nothing and resets nothing when the listing itself fails', async () => {
    await setToken(TOKEN)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(500, { message: 'boom' }))
    )

    await expect(syncDown()).rejects.toThrow()
    expect(spies.resetSession).toBe(0)
    expect(await getState()).toBeUndefined()
  })
})

// ============================================================================
// Push
// ============================================================================

describe('flushing the outbox', () => {
  it('groups events into one file per device, all in the month being written', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()

    // `laptopThen` is a backlogged edit: its own timestamp is months old, which
    // is exactly the case that used to be filed away where no warm device ever
    // looks again.
    const laptopNow = upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })
    const laptopThen = upsert({ id: 'b', seq: 2, device: 'laptop', ts: midMonth(OLD_MONTH) })
    const phoneNow = upsert({ id: 'c', seq: 3, device: 'phone', ts: midMonth(CURRENT_MONTH) })
    const laptopNowAgain = upsert({ id: 'd', seq: 4, device: 'laptop', ts: midMonth(CURRENT_MONTH) })
    await enqueue([laptopNow, laptopThen, phoneNow, laptopNowAgain])

    const result = await flushOutbox()

    expect(result).toEqual({ pushed: 4, remaining: 0, error: null })
    // Two files, not three: the append time decides the month, so nothing is
    // written into a month the read window has already moved past.
    expect(remote.puts.map((put) => put.path).sort()).toEqual(
      [`journal/${CURRENT_MONTH}.laptop.jsonl`, `journal/${CURRENT_MONTH}.phone.jsonl`].sort()
    )
    expect(remote.text(`journal/${OLD_MONTH}.laptop.jsonl`)).toBeUndefined()
    expect(remote.text(`journal/${CURRENT_MONTH}.laptop.jsonl`)).toBe(
      `${JSON.stringify(laptopNow)}\n${JSON.stringify(laptopThen)}\n${JSON.stringify(laptopNowAgain)}\n`
    )
    expect(remote.text(`journal/${CURRENT_MONTH}.phone.jsonl`)).toBe(`${JSON.stringify(phoneNow)}\n`)
    // The event keeps its own ts: the fold still orders it by when it happened.
    const backlogged = JSON.parse(
      (remote.text(`journal/${CURRENT_MONTH}.laptop.jsonl`) ?? '').split('\n')[1]
    ) as { id: string; ts: number }
    expect(backlogged).toMatchObject({ id: 'b', ts: midMonth(OLD_MONTH) })
    expect(await outboxSize()).toBe(0)
  })

  it('leaves a backlogged event visible to a warm pull, not only to a cold restore', async () => {
    await setToken(TOKEN)
    fakeGitHub()
    // Warm: this device already has a picture, so the pull below takes the
    // two-month window rather than everything.
    await setState({})
    await putCachedFile({
      path: `journal/${PREVIOUS_MONTH}.phone.jsonl`,
      text: '',
      sha: 'cached',
      fetchedAt: 1,
    })

    // Five weeks of failed pushes finally drain. The edit itself is old.
    await enqueue([upsert({ id: 'backlogged', seq: 1, device: 'laptop', ts: midMonth(OLD_MONTH) })])
    expect(await flushOutbox()).toMatchObject({ pushed: 1, remaining: 0, error: null })

    // A warm pull on any device, including the one that wrote it.
    resetSession()
    const pulled = await syncDown()
    expect(pulled?.cold).toBe(false)

    await hydrate()
    expect(Object.keys(currentState().habit ?? {})).toContain('backlogged')
  })

  it('pushes before it pulls, and never runs the two at the same time', async () => {
    await setToken(TOKEN)
    const path = `journal/${CURRENT_MONTH}.laptop.jsonl`
    const already = upsert({ id: 'remote-one', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })
    const remote = fakeGitHub({ files: { [path]: `${JSON.stringify(already)}\n` }, slow: true })
    await setState({})
    await putCachedFile({ path, text: `${JSON.stringify(already)}\n`, sha: 'stale', fetchedAt: 1 })

    // The edit the owner just made, still queued.
    await enqueue([upsert({ id: 'just-typed', seq: 2, device: 'laptop', ts: Date.now() })])

    const teardown = installSyncTriggers()
    document.dispatchEvent(new Event('visibilitychange'))
    await until(() => remote.puts.length === 1, 'the push')
    await until(
      () => remote.log.includes('GET journal') && remote.maxInFlight > 0,
      'the pull to start'
    )
    await settle()
    teardown()

    // Never overlapping, and the push came first.
    expect(remote.maxInFlight).toBe(1)
    expect(remote.log.indexOf(`PUT ${path}`)).toBeLessThan(remote.log.indexOf('GET journal'))

    // And the consequence: the cache the pull left behind still contains the
    // line the push had just added.
    const cached = await getCachedFile(path)
    expect(cached?.text).toContain('just-typed')
    expect(await outboxSize()).toBe(0)
  })

  it('stamps lastBackupAt and clears the push error it owns, and only that one', async () => {
    await setToken(TOKEN)
    fakeGitHub()
    // Both signals set beforehand, so clearing them is actually observable.
    await setMeta('lastBackupError', 'an earlier push was refused')
    await setMeta('lastBackupErrorKind', 'auth')
    await setMeta('lastStateError', 'the cached state could not be saved: the quota is exhausted')
    await enqueue([upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])

    const before = Date.now()
    await flushOutbox()
    const stamped = await getMeta<number>('lastBackupAt')

    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(await getMeta('lastBackupError')).toBeUndefined()
    expect(await getMeta('lastBackupErrorKind')).toBeUndefined()
    // Not the push's to clear: a good backup says nothing about a local write
    // that failed.
    expect(await getMeta<string>('lastStateError')).toEqual(expect.any(String))
  })

  it('records the failure kind next to the message, and clears both on the next clean push', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()
    remote.failPuts.push(429)
    await enqueue([upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])

    await flushOutbox()

    // A rate limit is not a bad token; the consumer needs the kind to say so.
    expect(await getMeta<string>('lastBackupError')).toEqual(expect.any(String))
    expect(await getMeta<string>('lastBackupErrorKind')).toBe('ratelimit')

    await flushOutbox()

    expect(await getMeta('lastBackupError')).toBeUndefined()
    expect(await getMeta('lastBackupErrorKind')).toBeUndefined()
    expect(await outboxSize()).toBe(0)
  })

  it('carries on past a failure that belongs to one path only', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()
    // The laptop file is over 1 MB; the phone file is fine. Stopping here would
    // wedge the phone's events behind it for as long as the month lasts.
    remote.failPuts.push(413, null)
    await enqueue([
      upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) }),
      upsert({ id: 'b', seq: 2, device: 'phone', ts: midMonth(CURRENT_MONTH) }),
    ])

    const result = await flushOutbox()

    expect(result?.pushed).toBe(1)
    expect(result?.remaining).toBe(1)
    expect(remote.puts.map((put) => put.path)).toEqual([
      `journal/${CURRENT_MONTH}.laptop.jsonl`,
      `journal/${CURRENT_MONTH}.phone.jsonl`,
    ])
    expect((await peekOutbox()).map((row) => row.id)).toEqual(['a'])
    expect(await getMeta<string>('lastBackupErrorKind')).toBe('http')
  })

  it('stops at the first failure that belongs to the whole connection', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()
    remote.failPuts.push(401, null)
    await enqueue([
      upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) }),
      upsert({ id: 'b', seq: 2, device: 'phone', ts: midMonth(CURRENT_MONTH) }),
    ])

    const result = await flushOutbox()

    expect(result?.pushed).toBe(0)
    expect(result?.remaining).toBe(2)
    // The second group was never even attempted.
    expect(remote.puts.map((put) => put.path)).toEqual([`journal/${CURRENT_MONTH}.laptop.jsonl`])
    expect(await getMeta<string>('lastBackupErrorKind')).toBe('auth')
  })

  it('records a local failure that lands after GitHub already took the events', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()
    await enqueue([upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])
    dbFaults.removeFromOutbox = true

    const result = await flushOutbox()

    // The push happened; the local bookkeeping did not.
    expect(remote.puts).toHaveLength(1)
    expect(result?.error).not.toBeNull()
    expect(await outboxSize()).toBe(1)
    expect(await getMeta('lastBackupAt')).toBeUndefined()
    // Without this the owner has no signal at all: nothing red, nothing newer.
    expect(await getMeta<string>('lastBackupError')).toEqual(expect.any(String))
    // No GitHub error, so no kind to report.
    expect(await getMeta('lastBackupErrorKind')).toBeUndefined()
  })

  it('records a failure when the outbox cannot be read at all', async () => {
    await setToken(TOKEN)
    fakeGitHub()
    dbFaults.getToken = true

    const result = await flushOutbox()

    expect(result?.error).not.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(await getMeta<string>('lastBackupError')).toEqual(expect.any(String))
  })

  it('hands two overlapping callers the one attempt, not a second empty one', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub({ slow: true })
    await enqueue([upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])

    const [first, second] = await Promise.all([flushOutbox(), flushOutbox()])

    expect(second).toBe(first)
    expect(second?.pushed).toBe(1)
    expect(remote.puts).toHaveLength(1)
  })

  it('leaves the outbox intact and does not advance lastBackupAt when the push fails', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()
    remote.failPuts.push(401)
    await enqueue([
      upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) }),
      upsert({ id: 'b', seq: 2, device: 'laptop', ts: midMonth(CURRENT_MONTH) }),
    ])

    const result = await flushOutbox()

    expect(result?.pushed).toBe(0)
    expect(result?.remaining).toBe(2)
    expect(result?.error).not.toBeNull()
    expect(await outboxSize()).toBe(2)
    expect((await peekOutbox()).map((row) => row.id)).toEqual(['a', 'b'])
    expect(await getMeta('lastBackupAt')).toBeUndefined()
    expect(await getMeta<string>('lastBackupError')).toEqual(expect.any(String))
  })

  it('does not roll back a lastBackupAt earned by an earlier flush', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()
    await enqueue([upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])
    await flushOutbox()
    const earned = await getMeta<number>('lastBackupAt')

    remote.failPuts.push(500)
    await enqueue([upsert({ id: 'b', seq: 2, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])
    await flushOutbox()

    expect(await getMeta<number>('lastBackupAt')).toBe(earned)
    expect(await outboxSize()).toBe(1)
  })

  it('removes only the ids that were actually written', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()
    // Two groups: the first file's PUT lands, the second file's PUT is refused.
    remote.failPuts.push(null, 403)
    await enqueue([
      upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) }),
      upsert({ id: 'b', seq: 2, device: 'laptop', ts: midMonth(CURRENT_MONTH) }),
      upsert({ id: 'c', seq: 3, device: 'phone', ts: midMonth(CURRENT_MONTH) }),
    ])

    const result = await flushOutbox()

    expect(result?.pushed).toBe(2)
    expect(result?.remaining).toBe(1)
    expect((await peekOutbox()).map((row) => row.id)).toEqual(['c'])
    expect(remote.text(`journal/${CURRENT_MONTH}.laptop.jsonl`)).toContain('"id":"a"')
    expect(await getMeta('lastBackupAt')).toBeUndefined()
    expect(await getMeta<string>('lastBackupError')).toEqual(expect.any(String))
  })
})

// ============================================================================
// Triggers
// ============================================================================

describe('the sync triggers', () => {
  async function queueOneEdit() {
    await setToken(TOKEN)
    await enqueue([upsert({ id: 'a', seq: 1, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])
  }

  it('pushes on pagehide and on focus', async () => {
    await queueOneEdit()
    const remote = fakeGitHub()

    const teardown = installSyncTriggers()
    window.dispatchEvent(new Event('pagehide'))
    await until(() => remote.puts.length === 1, 'the pagehide push')

    await enqueue([upsert({ id: 'b', seq: 2, device: 'laptop', ts: midMonth(CURRENT_MONTH) })])
    window.dispatchEvent(new Event('focus'))
    await until(() => remote.puts.length === 2, 'the focus push')
    teardown()
  })

  it('stops listening once torn down', async () => {
    await queueOneEdit()
    fakeGitHub()

    const teardown = installSyncTriggers()
    teardown()

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pagehide'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()

    // A teardown that removes nothing leaks a listener per mount, and React's
    // development double-mount makes that immediate.
    expect(fetch).not.toHaveBeenCalled()
    expect(await outboxSize()).toBe(1)
  })

  it('does not push while the debounce is still running', async () => {
    await queueOneEdit()
    const remote = fakeGitHub()

    const teardown = installSyncTriggers()
    scheduleFlush()
    // Long enough that a debounce collapsed to nothing would have finished a
    // whole round trip by now, and far short of FLUSH_DEBOUNCE_MS.
    await settle(300)

    expect(remote.puts).toHaveLength(0)
    expect(await outboxSize()).toBe(1)
    teardown()
  })

  it('pushes once the debounce elapses', async () => {
    await queueOneEdit()
    const remote = fakeGitHub()

    // Only the timer is faked: fake-indexeddb still runs on the real loop.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    scheduleFlush()
    vi.advanceTimersByTime(FLUSH_DEBOUNCE_MS)
    vi.useRealTimers()

    await until(() => remote.puts.length === 1, 'the debounced push')
    expect(await outboxSize()).toBe(0)
  })
})

// ============================================================================
// One edit, one event
// ============================================================================

describe('one edit, one event', () => {
  it('queues exactly one event for one habit toggle, and pushes exactly one line', async () => {
    const { toggleCompletion } = await import('../services/data')
    await setToken(TOKEN)
    const remote = fakeGitHub()

    await toggleCompletion('habit-1', '2026-08-24', true)

    expect(await outboxSize()).toBe(1)

    await flushOutbox()

    const written = remote.puts[0]
    expect(remote.puts).toHaveLength(1)
    expect(written.text.split('\n').filter((line) => line.length > 0)).toHaveLength(1)
    expect(await outboxSize()).toBe(0)
  })

  it('queues exactly one event per toggle through the provider, and loads once under StrictMode', async () => {
    const { StrictMode, createElement } = await import('react')
    const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react')
    const { AppProvider, useApp } = await import('../store/AppContext')

    const today = '2026-08-24'

    function Probe() {
      const { state, toggleHabit } = useApp()
      const first = state.settings.habits[0]
      return createElement(
        'button',
        {
          'data-testid': 'toggle',
          disabled: first === undefined,
          onClick: () => {
            if (first !== undefined) void toggleHabit(today, first.id)
          },
        },
        'toggle'
      )
    }

    render(
      createElement(StrictMode, null, createElement(AppProvider, null, createElement(Probe, null)))
    )

    // Wait for the local read to land. Nothing here touches the network.
    await waitFor(() => {
      expect(screen.getByTestId('toggle')).toBeEnabled()
    })

    // StrictMode mounts, unmounts and remounts. The load must still be once.
    expect(dataCalls.getHabits).toBe(1)

    fireEvent.click(screen.getByTestId('toggle'))

    // The write finishes on IndexedDB's own schedule, not React's.
    await waitFor(async () => {
      expect(await outboxSize()).toBe(1)
    })

    expect(dataCalls.toggleCompletion).toBe(1)
    expect(await peekOutbox()).toHaveLength(1)

    cleanup()
  })
})
