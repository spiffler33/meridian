import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The wiring between the provider and the sync module.
 *
 * Every test here fails if a single line of that wiring is removed: the
 * triggers effect, the debounce effect, the pull on open, and the reload that
 * has to follow a pull. The module is wrapped rather than replaced, so the
 * counts and the real behaviour are checked by the same run.
 */
const syncCalls = vi.hoisted(() => ({ installSyncTriggers: 0, scheduleFlush: 0, syncDown: 0 }))

vi.mock('../lib/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sync')>()
  return {
    ...actual,
    installSyncTriggers: (...args: Parameters<typeof actual.installSyncTriggers>) => {
      syncCalls.installSyncTriggers += 1
      return actual.installSyncTriggers(...args)
    },
    scheduleFlush: (...args: Parameters<typeof actual.scheduleFlush>) => {
      syncCalls.scheduleFlush += 1
      return actual.scheduleFlush(...args)
    },
    syncDown: (...args: Parameters<typeof actual.syncDown>) => {
      syncCalls.syncDown += 1
      return actual.syncDown(...args)
    },
  }
})

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GITHUB_API_BASE, GITHUB_OWNER, GITHUB_REPO } from '../lib/github'
import { closeDb, enqueue, outboxSize, setToken } from '../lib/db'
import { resetSession } from '../lib/entities'
import { toggleCompletion } from '../services/data'
import { FLUSH_DEBOUNCE_MS, installSyncTriggers } from '../lib/sync'
import { AppProvider, useApp } from './AppContext'
import type { MitCategory } from '../types'

const TOKEN = 'test-token-not-a-real-pat'
const REPO_BASE = `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}`
const TODAY = new Date()
const TODAY_ISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(
  TODAY.getDate()
).padStart(2, '0')}`
const CURRENT_MONTH = TODAY.toISOString().slice(0, 7)

// ============================================================================
// A fake remote, just enough of the contents API for one journal file
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

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

function fakeGitHub(files: Record<string, string> = {}) {
  const stored = new Map<string, { text: string; sha: string }>()
  let shaCount = 0
  const nextSha = () => {
    shaCount += 1
    return `sha${shaCount}`
  }
  for (const [path, text] of Object.entries(files)) stored.set(path, { text, sha: nextSha() })

  const control = { puts: [] as { path: string; text: string }[] }

  const handler = async (input: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    const suffix = input.slice(REPO_BASE.length)
    const path = suffix.startsWith('/contents/')
      ? decodeURIComponent(suffix.slice('/contents/'.length))
      : ''

    if (path === 'journal' && method === 'GET') {
      return response(
        200,
        [...stored.entries()].map(([full, file]) => ({
          name: full.slice('journal/'.length),
          path: full,
          sha: file.sha,
          type: 'file',
        }))
      )
    }
    if (method === 'GET') {
      const file = stored.get(path)
      if (file === undefined) return response(404, { message: 'Not Found' })
      return response(200, { content: encode(file.text), encoding: 'base64', sha: file.sha })
    }
    if (method === 'PUT') {
      const body = init?.body === undefined ? null : (JSON.parse(init.body) as Record<string, unknown>)
      const text = decode(String(body?.content ?? ''))
      control.puts.push({ path, text })
      stored.set(path, { text, sha: nextSha() })
      return response(200, { content: { sha: nextSha() } })
    }
    return response(405, { message: 'not implemented' })
  }

  vi.stubGlobal('fetch', vi.fn(handler))
  return control
}

function habitEvent(id: string, label: string) {
  return {
    id,
    seq: 1,
    device: 'other-device',
    ts: Date.now() - 1_000,
    entity: 'habit',
    entityId: id,
    type: 'upsert' as const,
    fields: { label, sort_order: 0 },
  }
}

async function until(predicate: () => boolean, label: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// ============================================================================
// Probes
// ============================================================================

/** Renders the habit labels the provider is holding, one per line. */
function HabitProbe() {
  const { state } = useApp()
  return createElement(
    'div',
    { 'data-testid': 'habits' },
    state.settings.habits.map((habit) => habit.label).join('|')
  )
}

/** A button that makes one real edit through the provider. */
function TogglingProbe() {
  const { state, toggleHabit } = useApp()
  const first = state.settings.habits[0]
  return createElement(
    'button',
    {
      'data-testid': 'toggle',
      disabled: first === undefined,
      onClick: () => {
        if (first !== undefined) toggleHabit(TODAY_ISO, first.id)
      },
    },
    'toggle'
  )
}

/** Renders the ticked habits and the MITs for today. */
function DayProbe() {
  const { state, getDailyData } = useApp()
  const day = getDailyData(TODAY_ISO)
  const ticked = Object.entries(day.habits)
    .filter(([, on]) => on)
    .map(([id]) => id)
  const mits = (['work', 'self', 'family'] as MitCategory[]).flatMap((category) =>
    day.mit[category].map((item) => `${category}:${item.text}`)
  )
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'ready' }, state.settings.habits.length > 0 ? 'yes' : 'no'),
    createElement('span', { 'data-testid': 'ticked' }, ticked.join('|')),
    createElement('span', { 'data-testid': 'mits' }, mits.join('|'))
  )
}

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  resetSession()
  syncCalls.installSyncTriggers = 0
  syncCalls.scheduleFlush = 0
  syncCalls.syncDown = 0
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  // Cancels any debounce a test left pending, so it cannot fire against a
  // database that is about to be deleted.
  installSyncTriggers()()
  vi.unstubAllGlobals()
  resetSession()
  await closeDb()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('meridian')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'))
    request.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'))
  })
})

// ============================================================================
// Sync wiring
// ============================================================================

describe('the provider and the sync module', () => {
  it('pulls on open and re-reads what the pull brought', async () => {
    await setToken(TOKEN)
    fakeGitHub({
      [`journal/${CURRENT_MONTH}.other-device.jsonl`]: `${JSON.stringify(
        habitEvent('from-the-repo', 'Written elsewhere')
      )}\n`,
    })

    render(createElement(AppProvider, null, createElement(HabitProbe, null)))

    // Nothing but the pull can put this label on screen: the local store starts
    // empty, so a provider that never pulls falls back to the built-in habits.
    await waitFor(() => {
      expect(screen.getByTestId('habits')).toHaveTextContent('Written elsewhere')
    })
    expect(syncCalls.syncDown).toBeGreaterThan(0)
  })

  it('syncs when the tab comes back to the foreground', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()
    await enqueue([habitEvent('queued', 'Queued edit')])

    render(createElement(AppProvider, null, createElement(HabitProbe, null)))
    await waitFor(() => {
      expect(screen.getByTestId('habits')).toBeInTheDocument()
    })
    expect(syncCalls.installSyncTriggers).toBeGreaterThan(0)

    window.dispatchEvent(new Event('focus'))

    // Well inside the debounce, so only a real trigger can explain this push.
    await until(() => remote.puts.length === 1, 'the foreground push', 2_000)
    expect(await outboxSize()).toBe(0)
  })

  it('pushes an edit on its own, with no foreground event at all', async () => {
    await setToken(TOKEN)
    const remote = fakeGitHub()

    render(createElement(AppProvider, null, createElement(TogglingProbe, null)))
    await waitFor(() => {
      expect(screen.getByTestId('toggle')).toBeEnabled()
    })

    const scheduledOnMount = syncCalls.scheduleFlush
    expect(scheduledOnMount).toBeGreaterThan(0)

    fireEvent.click(screen.getByTestId('toggle'))
    await waitFor(async () => {
      expect(await outboxSize()).toBe(1)
    })
    expect(syncCalls.scheduleFlush).toBeGreaterThan(scheduledOnMount)

    // Real time, on purpose. Nothing is dispatched here: if the provider does
    // not schedule its own flush after an edit, nothing ever pushes.
    await until(() => remote.puts.length === 1, 'the self-scheduled push', FLUSH_DEBOUNCE_MS + 4_000)
    expect(await outboxSize()).toBe(0)
    // The debounce is real time, so this one test has to outlast it.
  }, FLUSH_DEBOUNCE_MS + 10_000)
})

// ============================================================================
// A reload has to make deletions disappear
// ============================================================================

describe('reloading the window', () => {
  /**
   * The real path: the queued edits go up on focus, the pull brings the file
   * back down, and only a pull that changed something makes the provider
   * re-read. Nothing here reaches into the provider.
   */
  function reload() {
    window.dispatchEvent(new Event('focus'))
  }

  it('drops a habit tick that was removed since the last read', async () => {
    await setToken(TOKEN)
    fakeGitHub()
    await toggleCompletion('habit-x', TODAY_ISO, true)

    render(createElement(AppProvider, null, createElement(DayProbe, null)))
    await waitFor(() => {
      expect(screen.getByTestId('ticked')).toHaveTextContent('habit-x')
    })

    // The other device untisked it. Locally that is a delete event, so the next
    // read simply does not mention the date at all.
    await toggleCompletion('habit-x', TODAY_ISO, false)
    reload()

    await waitFor(() => {
      expect(screen.getByTestId('ticked')).toHaveTextContent('')
    })
  })
})
