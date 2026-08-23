import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The three IndexedDB calls the write and load paths depend on, each able to
 * fail on demand. Everything else passes straight through to the real module,
 * so the rest of the suite is unaffected.
 */
const failures = vi.hoisted(() => ({ allCachedFiles: false, enqueue: false, setState: false }))

/**
 * Holds `load` still after it has read the device but before it assigns, which
 * is the only window in which a reset or a write can race it.
 */
type Gate = { arrive: () => void; opened: Promise<void> }

const held = vi.hoisted(() => ({
  peekOutbox: null as null | Gate,
  setState: null as null | Gate,
}))

vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return {
    ...actual,
    allCachedFiles: async () => {
      if (failures.allCachedFiles) throw new Error('the database is busy')
      return actual.allCachedFiles()
    },
    peekOutbox: async (limit?: number) => {
      const rows = await actual.peekOutbox(limit)
      const gate = held.peekOutbox
      if (gate !== null) {
        held.peekOutbox = null
        gate.arrive()
        await gate.opened
      }
      return rows
    },
    enqueue: async (events: Parameters<typeof actual.enqueue>[0]) => {
      if (failures.enqueue) throw new Error('the outbox is unavailable')
      return actual.enqueue(events)
    },
    setState: async (state: unknown) => {
      if (failures.setState) throw new Error('the quota is exhausted')
      const gate = held.setState
      if (gate !== null) {
        held.setState = null
        gate.arrive()
        await gate.opened
      }
      return actual.setState(state)
    },
  }
})

import { closeDb, getMeta, outboxSize, putCachedFile } from './db'
import {
  commit,
  currentState,
  hydrate,
  newId,
  resetSession,
  resolveEntityId,
  uniqueByKey,
} from './entities'
import { fold } from './journal'
import type { JournalEvent } from './journal'
import {
  archivePack,
  completeTowerItem,
  createHabit,
  createPack,
  createPackSession,
  createTask,
  createTowerItem,
  deleteHabit,
  deletePackSession,
  deleteTask,
  deleteTowerItem,
  deleteYearTheme,
  getAllYearThemes,
  getCompletions,
  getCompletionsForDate,
  getDailyDataRange,
  getDailyEntry,
  getHabitCompletionDates,
  getHabitStreak,
  getHabits,
  getPackSessions,
  getPacks,
  getProfile,
  getTasks,
  getTasksRange,
  getTowerItems,
  getTowerItemsByStatus,
  getYearTheme,
  loadAllData,
  reorderHabits,
  restoreHabit,
  setYearTheme,
  toggleCompletion,
  updateHabit,
  updatePack,
  updatePackSession,
  updateProfile,
  updateTask,
  updateTowerItem,
  upsertDailyEntry,
} from '../services/data'

// --- fixtures ---------------------------------------------------------------

const SEED_TS = 1_700_000_000_000

let seedSeq = 0

/** One seeded upsert line, exactly as a journal file carries it. */
function line(entity: string, entityId: string, fields: Record<string, unknown>): string {
  seedSeq += 1
  return JSON.stringify({
    id: `seed-${seedSeq}`,
    device: 'seed',
    seq: seedSeq,
    ts: SEED_TS + seedSeq,
    type: 'upsert',
    entity,
    entityId,
    fields,
  })
}

/** Puts a journal file in the cache, the way a sync would have. */
async function seed(...lines: string[]): Promise<void> {
  await putCachedFile({
    path: 'journal/2026-01.seed.jsonl',
    text: `${lines.join('\n')}\n`,
    sha: null,
    fetchedAt: SEED_TS,
  })
}

/** How many entities of one kind survive in the session's folded state. */
function entityIds(entity: string): string[] {
  return Object.keys(currentState()[entity] ?? {}).sort()
}

beforeEach(() => {
  seedSeq = 0
  failures.allCachedFiles = false
  failures.enqueue = false
  failures.setState = false
  held.peekOutbox = null
  held.setState = null
  resetSession()
})

/** A gate the mocked read stops at, plus a promise that says it got there. */
function latch(): { arrived: Promise<void>; arrive: () => void; opened: Promise<void>; open: () => void } {
  let arrive!: () => void
  let open!: () => void
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve
  })
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { arrived, arrive, opened, open }
}

afterEach(async () => {
  vi.useRealTimers()
  resetSession()
  await closeDb()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('meridian')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
    req.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'))
  })
})

// --- a device that has never synced ----------------------------------------

describe('a fresh device with no journal at all', () => {
  // fold() omits a bucket entirely when nothing of that type survives, so on
  // this path every read is looking at `{}`. This is the airplane-mode cold
  // open: a getter that throws here takes the whole first paint with it.
  it('answers every read without throwing', async () => {
    expect(await getHabits()).toEqual([])
    expect(await getHabits(true)).toEqual([])
    expect(await getDailyEntry('2026-01-05')).toBeNull()
    expect(await getCompletions('2026-01-01', '2026-12-31')).toEqual([])
    expect(await getCompletionsForDate('2026-01-05')).toEqual({})
    expect(await getTasks('2026-01-05')).toEqual([])
    expect(await getTasksRange('2026-01-01', '2026-12-31')).toEqual([])
    expect(await getYearTheme(2026)).toBeNull()
    expect(await getAllYearThemes()).toEqual([])
    expect(await getHabitStreak('nobody')).toEqual({ current: 0, longest: 0 })
    expect(await getHabitCompletionDates('nobody')).toEqual([])
    expect(await getTowerItems()).toEqual([])
    expect(await getTowerItemsByStatus('active')).toEqual([])
    expect(await getPacks()).toEqual([])
    expect(await getPackSessions('nobody')).toEqual([])
    expect(await getDailyDataRange('2026-01-01', '2026-12-31')).toEqual({
      entries: [],
      completions: [],
      tasks: [],
    })
  })

  it('hands back a default profile rather than failing', async () => {
    const profile = await getProfile()
    expect(profile.ai_tone).toBe('stoic')
    expect(profile.week_starts_on).toBe(1)
    expect(profile.personal_context).toBeNull()

    const all = await loadAllData()
    expect(all.habits).toEqual([])
    expect(all.profile.id).toBe(profile.id)
  })

  it('takes a first write with nothing to fold onto', async () => {
    const habit = await createHabit({ label: 'Read', category: 'learning' })
    expect(habit.sort_order).toBe(0)
    expect(await getHabits()).toHaveLength(1)
  })
})

// --- tower surfacing order --------------------------------------------------

describe('tower ordering: expects_by ASC NULLS LAST, then last_touched ASC', () => {
  beforeEach(async () => {
    await seed(
      // ids chosen so that ordering by id alone gives a different answer
      line('towerItem', 't-a', {
        text: 'A',
        status: 'active',
        expects_by: '2026-03-01',
        last_touched: '2026-01-01T00:00:00.000Z',
      }),
      line('towerItem', 't-b', {
        text: 'B',
        status: 'active',
        expects_by: null,
        last_touched: '2026-01-01T00:00:00.000Z',
      }),
      line('towerItem', 't-c', {
        text: 'C',
        status: 'active',
        expects_by: '2026-02-01',
        last_touched: '2026-01-05T00:00:00.000Z',
      }),
      line('towerItem', 't-d', {
        text: 'D',
        status: 'active',
        expects_by: null,
        last_touched: '2025-12-01T00:00:00.000Z',
      }),
      line('towerItem', 't-e', {
        text: 'E',
        status: 'done',
        expects_by: null,
        last_touched: '2025-11-01T00:00:00.000Z',
      })
    )
  })

  it('puts dated items first in date order, then undated by last touch', async () => {
    const items = await getTowerItems()
    expect(items.map((item) => item.text)).toEqual(['C', 'A', 'D', 'B'])
  })

  it('keeps the same order when done items are included', async () => {
    const items = await getTowerItems(true)
    expect(items.map((item) => item.text)).toEqual(['C', 'A', 'E', 'D', 'B'])
  })

  it('orders by status the same way', async () => {
    const items = await getTowerItemsByStatus('active')
    expect(items.map((item) => item.text)).toEqual(['C', 'A', 'D', 'B'])
  })
})

// --- pack session counts ----------------------------------------------------

describe('getPacks session counts', () => {
  beforeEach(async () => {
    await seed(
      line('pack', 'p-1', { label: 'Massage', total: 10, created_at: '2026-01-03T00:00:00.000Z' }),
      line('pack', 'p-2', { label: 'Pilates', total: 5, created_at: '2026-01-02T00:00:00.000Z' }),
      line('pack', 'p-3', {
        label: 'Old',
        total: 2,
        created_at: '2026-01-01T00:00:00.000Z',
        archived_at: '2026-01-09T00:00:00.000Z',
      }),
      line('packSession', 's-1', { pack_id: 'p-1', date: '2026-01-04' }),
      line('packSession', 's-2', { pack_id: 'p-1', date: '2026-01-05' }),
      line('packSession', 's-3', { pack_id: 'p-1', date: '2026-01-06' }),
      line('packSession', 's-4', { pack_id: 'p-3', date: '2026-01-07' })
    )
  })

  it('counts each pack’s own sessions', async () => {
    const packs = await getPacks()
    expect(packs.map((pack) => [pack.label, pack.used])).toEqual([
      ['Massage', 3],
      ['Pilates', 0],
    ])
  })

  it('excludes archived packs unless asked, and still counts them when asked', async () => {
    const all = await getPacks(true)
    expect(all.map((pack) => pack.label)).toEqual(['Massage', 'Pilates', 'Old'])
    expect(all[2].used).toBe(1)
    expect(all[2].archivedAt).toBe('2026-01-09T00:00:00.000Z')
  })

  it('follows a newly logged session', async () => {
    await createPackSession({ packId: 'p-2', date: '2026-01-10' })
    const packs = await getPacks()
    expect(packs.find((pack) => pack.label === 'Pilates')?.used).toBe(1)
  })
})

// --- sort_order on create ---------------------------------------------------

describe('sort_order is assigned as max + 1', () => {
  it('createHabit counts archived habits too', async () => {
    await seed(
      line('habit', 'h-1', { label: 'One', category: 'health', sort_order: 0 }),
      line('habit', 'h-2', { label: 'Two', category: 'health', sort_order: 5 }),
      line('habit', 'h-3', {
        label: 'Gone',
        category: 'health',
        sort_order: 9,
        archived_at: '2026-01-02T00:00:00.000Z',
      })
    )

    const created = await createHabit({ label: 'Three', category: 'work' })
    expect(created.sort_order).toBe(10)
    expect((await getHabits()).map((habit) => habit.label)).toEqual(['One', 'Two', 'Three'])
  })

  it('createTask scopes the maximum to the same date AND category', async () => {
    await seed(
      line('task', 'k-1', { date: '2026-01-05', category: 'work', text: 'a', sort_order: 0 }),
      line('task', 'k-2', { date: '2026-01-05', category: 'work', text: 'b', sort_order: 1 }),
      line('task', 'k-3', { date: '2026-01-05', category: 'self', text: 'c', sort_order: 7 }),
      line('task', 'k-4', { date: '2026-01-06', category: 'work', text: 'd', sort_order: 4 })
    )

    const created = await createTask({ date: '2026-01-05', category: 'work', text: 'e' })
    expect(created.sort_order).toBe(2)
    expect(created.completed).toBe(false)
    expect(created.completed_at).toBeNull()

    const firstOfADay = await createTask({ date: '2026-02-01', category: 'family', text: 'f' })
    expect(firstOfADay.sort_order).toBe(0)
  })

  it('orders tasks by category then sort_order', async () => {
    await seed(
      line('task', 'k-1', { date: '2026-01-05', category: 'work', text: 'w0', sort_order: 0 }),
      line('task', 'k-2', { date: '2026-01-05', category: 'self', text: 's1', sort_order: 1 }),
      line('task', 'k-3', { date: '2026-01-05', category: 'self', text: 's0', sort_order: 0 }),
      line('task', 'k-4', { date: '2026-01-05', category: 'family', text: 'f0', sort_order: 0 })
    )

    expect((await getTasks('2026-01-05')).map((task) => task.text)).toEqual([
      'f0',
      's0',
      's1',
      'w0',
    ])
    expect((await getTasksRange('2026-01-01', '2026-01-31')).map((task) => task.text)).toEqual([
      'f0',
      's0',
      's1',
      'w0',
    ])
  })
})

// --- updateTask's completed_at side effect ----------------------------------

describe('updateTask maintains completed_at', () => {
  it('sets it on completion and clears it on un-completion', async () => {
    const task = await createTask({ date: '2026-01-05', category: 'work', text: 'ship' })
    expect(task.completed_at).toBeNull()

    const done = await updateTask(task.id, { completed: true })
    expect(done.completed).toBe(true)
    expect(typeof done.completed_at).toBe('string')
    expect(done.completed_at).not.toBeNull()

    const undone = await updateTask(task.id, { completed: false })
    expect(undone.completed).toBe(false)
    expect(undone.completed_at).toBeNull()
  })

  it('leaves an explicit completed_at alone', async () => {
    const task = await createTask({ date: '2026-01-05', category: 'work', text: 'ship' })
    const done = await updateTask(task.id, {
      completed: true,
      completed_at: '2026-01-05T09:00:00.000Z',
    })
    expect(done.completed_at).toBe('2026-01-05T09:00:00.000Z')
  })

  it('does not disturb other fields', async () => {
    const task = await createTask({
      date: '2026-01-05',
      category: 'work',
      text: 'ship',
      firstStep: 'open the editor',
    })
    const renamed = await updateTask(task.id, { text: 'ship it' })
    expect(renamed.text).toBe('ship it')
    expect(renamed.first_step).toBe('open the editor')
    expect(renamed.completed).toBe(false)
  })
})

// --- soft delete vs real delete ---------------------------------------------

describe('soft deletes keep the record, real deletes remove it', () => {
  it('deleteHabit archives', async () => {
    const habit = await createHabit({ label: 'Read', category: 'learning' })
    await deleteHabit(habit.id)

    expect(await getHabits()).toEqual([])
    const archived = await getHabits(true)
    expect(archived).toHaveLength(1)
    expect(typeof archived[0].archived_at).toBe('string')
    expect(entityIds('habit')).toEqual([habit.id])
  })

  it('archivePack archives', async () => {
    const pack = await createPack({ label: 'Massage', total: 10 })
    await archivePack(pack.id)

    expect(await getPacks()).toEqual([])
    const archived = await getPacks(true)
    expect(archived).toHaveLength(1)
    expect(typeof archived[0].archivedAt).toBe('string')
    expect(entityIds('pack')).toEqual([pack.id])
  })

  it('deleteTask removes the entity entirely', async () => {
    const task = await createTask({ date: '2026-01-05', category: 'work', text: 'ship' })
    await deleteTask(task.id)

    expect(await getTasks('2026-01-05')).toEqual([])
    expect(entityIds('task')).toEqual([])
  })

  it('deleteTowerItem removes the entity entirely', async () => {
    const item = await createTowerItem({ text: 'call the plumber' })
    await deleteTowerItem(item.id)

    expect(await getTowerItems(true)).toEqual([])
    expect(entityIds('towerItem')).toEqual([])
  })

  it('deletePackSession removes the entity entirely', async () => {
    const pack = await createPack({ label: 'Massage', total: 10 })
    const session = await createPackSession({ packId: pack.id, date: '2026-01-05' })
    await deletePackSession(session.id)

    expect(await getPackSessions(pack.id)).toEqual([])
    expect(entityIds('packSession')).toEqual([])
    expect((await getPacks())[0].used).toBe(0)
  })

  it('deleteYearTheme removes the entity entirely', async () => {
    await setYearTheme(2026, 'Momentum')
    await deleteYearTheme(2026)

    expect(await getYearTheme(2026)).toBeNull()
    expect(await getAllYearThemes()).toEqual([])
    expect(entityIds('yearTheme')).toEqual([])
  })
})

// --- composite keys ---------------------------------------------------------

describe('a composite key maps to one stable entity', () => {
  it('toggling the same habit and date twice writes one entity, not two', async () => {
    await toggleCompletion('h-1', '2026-01-05', true)
    await toggleCompletion('h-1', '2026-01-05', true)

    expect(entityIds('habitCompletion')).toHaveLength(1)
    expect(await getCompletionsForDate('2026-01-05')).toEqual({ 'h-1': true })
  })

  it('a different habit or a different date is a different entity', async () => {
    await toggleCompletion('h-1', '2026-01-05', true)
    await toggleCompletion('h-2', '2026-01-05', true)
    await toggleCompletion('h-1', '2026-01-06', true)

    expect(entityIds('habitCompletion')).toHaveLength(3)
  })

  it('toggling off deletes, and toggling on again stays one entity', async () => {
    await toggleCompletion('h-1', '2026-01-05', true)
    await toggleCompletion('h-1', '2026-01-05', false)
    expect(await getCompletionsForDate('2026-01-05')).toEqual({})
    expect(entityIds('habitCompletion')).toEqual([])

    await toggleCompletion('h-1', '2026-01-05', true)
    expect(entityIds('habitCompletion')).toHaveLength(1)
  })

  it('adopts a seeded row instead of writing a second one for the same day', async () => {
    // The seed carries each row's old surrogate id, so a local write has to
    // find that row by its natural key or it would shadow it forever.
    await seed(
      line('habitCompletion', 'ffff-old-uuid', { habit_id: 'h-1', date: '2026-01-05' }),
      line('dailyEntry', 'eeee-old-uuid', { date: '2026-01-05', focus: 'seeded focus' }),
      line('yearTheme', 'dddd-old-uuid', { year: 2026, theme: 'seeded theme' })
    )

    await toggleCompletion('h-1', '2026-01-05', false)
    expect(entityIds('habitCompletion')).toEqual([])
    expect(await getCompletionsForDate('2026-01-05')).toEqual({})

    await upsertDailyEntry('2026-01-05', { reflection: 'wrote it down' })
    expect(entityIds('dailyEntry')).toEqual(['eeee-old-uuid'])
    const entry = await getDailyEntry('2026-01-05')
    expect(entry?.focus).toBe('seeded focus')
    expect(entry?.reflection).toBe('wrote it down')

    await setYearTheme(2026, 'Momentum')
    expect(entityIds('yearTheme')).toEqual(['dddd-old-uuid'])
    expect(await getYearTheme(2026)).toBe('Momentum')
  })

  it('upserting the same date twice writes one entity and merges the fields', async () => {
    await upsertDailyEntry('2026-01-05', { focus: 'the one thing' })
    await upsertDailyEntry('2026-01-05', { isHoliday: true })

    expect(entityIds('dailyEntry')).toHaveLength(1)
    const entry = await getDailyEntry('2026-01-05')
    expect(entry?.focus).toBe('the one thing')
    expect(entry?.is_holiday).toBe(true)

    const range = await getDailyDataRange('2026-01-01', '2026-01-31')
    expect(range.entries).toHaveLength(1)
  })

  it('setting the same year twice writes one entity', async () => {
    await setYearTheme(2026, 'Momentum')
    await setYearTheme(2026, 'Depth')

    expect(entityIds('yearTheme')).toHaveLength(1)
    expect(await getYearTheme(2026)).toBe('Depth')
    expect(await getAllYearThemes()).toHaveLength(1)
  })
})

// --- streaks and completion reads -------------------------------------------

describe('habit completion reads', () => {
  // The clock is pinned and the dates are written out, because deriving them
  // with the same expression the implementation uses only asserts that the
  // expression equals itself — a day-boundary convention it got wrong would
  // agree with the test and still be wrong.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-15T09:00:00.000Z'))
  })

  it('counts one day once and keeps the streak semantics', async () => {
    await toggleCompletion('h-1', '2026-03-13', true)
    await toggleCompletion('h-1', '2026-03-14', true)
    await toggleCompletion('h-1', '2026-03-15', true)

    expect(await getHabitStreak('h-1')).toEqual({ current: 3, longest: 3 })
    expect(await getHabitCompletionDates('h-1')).toEqual([
      '2026-03-15',
      '2026-03-14',
      '2026-03-13',
    ])
  })

  it('counts a streak that ended yesterday as still current', async () => {
    await toggleCompletion('h-1', '2026-03-13', true)
    await toggleCompletion('h-1', '2026-03-14', true)

    expect(await getHabitStreak('h-1')).toEqual({ current: 2, longest: 2 })
  })

  it('does not call a streak current when the last day is older than yesterday', async () => {
    await toggleCompletion('h-1', '2026-03-10', true)
    await toggleCompletion('h-1', '2026-03-11', true)

    expect(await getHabitStreak('h-1')).toEqual({ current: 0, longest: 2 })
  })

  it('filters a range inclusively and orders by date', async () => {
    await toggleCompletion('h-1', '2026-01-10', true)
    await toggleCompletion('h-1', '2026-01-01', true)
    await toggleCompletion('h-1', '2026-02-01', true)

    const inRange = await getCompletions('2026-01-01', '2026-01-10')
    expect(inRange.map((row) => row.date)).toEqual(['2026-01-01', '2026-01-10'])
  })
})

// --- the write path ---------------------------------------------------------

describe('writes reach the outbox and survive a reload', () => {
  it('replays from the outbox after the session is dropped', async () => {
    const habit = await createHabit({ label: 'Read', category: 'learning' })
    await upsertDailyEntry('2026-01-05', { reflection: 'good day' })

    // A reload: the in-memory session is gone, IndexedDB is not.
    resetSession()

    const habits = await getHabits()
    expect(habits.map((row) => row.id)).toEqual([habit.id])
    expect((await getDailyEntry('2026-01-05'))?.reflection).toBe('good day')
  })
})

// --- fold performance -------------------------------------------------------

describe('performance', () => {
  /** 20,000 seeded completion events over 3,500 distinct entities. */
  function busyJournal(): string[] {
    const lines: string[] = []
    for (let index = 0; index < 20_000; index += 1) {
      lines.push(
        line('habitCompletion', `h-${index % 500}:2026-01-${(index % 28) + 1}`, {
          habit_id: `h-${index % 500}`,
          date: `2026-01-${(index % 28) + 1}`,
        })
      )
    }
    return lines
  }

  // Folding is the floor, not the cost of a write: a real commit also takes a
  // device id, a seq, the outbox write and — the part that grows with the
  // journal — a re-fold and a full rewrite of the cached state.
  it('commits one write against 20,000 events well inside a frame budget', async () => {
    await seed(...busyJournal())
    await hydrate()

    // the journal really is loaded, or the budget below measures nothing
    expect(entityIds('habitCompletion')).toHaveLength(3500)

    const started = performance.now()
    await commit([
      {
        entity: 'habit',
        entityId: newId(),
        type: 'upsert',
        fields: { label: 'Read', category: 'learning', sort_order: 0 },
      },
    ])
    const elapsed = performance.now() - started

    expect(await outboxSize()).toBe(1)
    expect(entityIds('habit')).toHaveLength(1)
    expect(elapsed).toBeLessThan(100)
  })

  it('folds 20,000 events in under 100 ms', () => {
    const events: JournalEvent[] = []
    for (let index = 0; index < 20_000; index += 1) {
      events.push({
        id: `e-${index}`,
        device: index % 2 === 0 ? 'aaaa' : 'bbbb',
        seq: index,
        ts: SEED_TS + index,
        type: 'upsert',
        entity: 'habitCompletion',
        entityId: `h-${index % 500}:2026-01-${(index % 28) + 1}`,
        fields: { habit_id: `h-${index % 500}`, date: `2026-01-${(index % 28) + 1}` },
      })
    }

    const started = performance.now()
    const { state, warnings } = fold(events)
    const elapsed = performance.now() - started

    expect(warnings).toEqual([])
    expect(Object.keys(state.habitCompletion ?? {}).length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(100)
  })
})

// --- ids ---------------------------------------------------------------------

describe('newId', () => {
  it('mints distinct ids', () => {
    expect(newId()).not.toBe(newId())
  })
})

// --- which row a natural key resolves to -------------------------------------

describe('resolveEntityId and uniqueByKey pick the same row', () => {
  type Row = { id: string; date: string }
  const rowKeyOf = (row: Row): string => row.date
  const dateOf = (record: Record<string, unknown>): string => String(record.date)

  const rows: Row[] = [
    { id: 'ccc', date: '2026-01-05' },
    { id: 'aaa', date: '2026-01-05' },
    { id: 'bbb', date: '2026-01-06' },
  ]

  it('resolves to the lowest id holding the key, not the first one seen', () => {
    // First-seen would answer 'ccc'. Two devices reading one journal in a
    // different order would then disagree about where to write, forever.
    expect(resolveEntityId(rows, rowKeyOf, '2026-01-05')).toBe('aaa')
    expect(resolveEntityId(rows, rowKeyOf, '2026-01-06')).toBe('bbb')
  })

  it('falls back to the key itself when nothing holds it', () => {
    expect(resolveEntityId(rows, rowKeyOf, '2026-02-01')).toBe('2026-02-01')
    expect(resolveEntityId([], rowKeyOf, '2026-02-01')).toBe('2026-02-01')
  })

  it('leaves the id the write targets on the surviving record', () => {
    const unique = uniqueByKey(
      {
        ccc: { date: '2026-01-05' },
        aaa: { date: '2026-01-05' },
        bbb: { date: '2026-01-06' },
      },
      dateOf
    )

    expect(unique.map((candidate) => candidate.id).sort()).toEqual(['aaa', 'bbb'])
  })

  it('breaks a tie with no timestamp to compare by the lowest id', () => {
    const unique = uniqueByKey(
      {
        zzz: { year: 2026, theme: 'from the higher id' },
        aaa: { year: 2026, theme: 'from the lower id' },
      },
      (record) => String(record.year)
    )

    expect(unique).toEqual([{ id: 'aaa', record: { year: 2026, theme: 'from the lower id' } }])
  })

  it('merges the records sharing a key instead of dropping the losers', () => {
    // Two tabs wrote the same day under different ids. The loser's record sits
    // in the journal forever; dropping it here makes it unreachable for good.
    const unique = uniqueByKey(
      {
        zzz: {
          date: '2026-01-05',
          focus: 'the one thing',
          is_holiday: true,
          updated_at: '2026-01-05T10:00:00.000Z',
        },
        aaa: {
          date: '2026-01-05',
          reflection: 'wrote it down',
          is_holiday: false,
          updated_at: '2026-01-05T09:00:00.000Z',
        },
      },
      dateOf
    )

    expect(unique).toEqual([
      {
        // the id resolveEntityId writes to, so reads and writes stay together
        id: 'aaa',
        record: {
          date: '2026-01-05',
          // the newer record wins a field they both wrote
          is_holiday: true,
          updated_at: '2026-01-05T10:00:00.000Z',
          focus: 'the one thing',
          // and the field only the older record wrote is kept, not dropped
          reflection: 'wrote it down',
        },
      },
    ])
  })

  it('still lets the newer record clear a column the older one filled', () => {
    const unique = uniqueByKey(
      {
        zzz: { date: '2026-01-05', reflection: null, updated_at: '2026-01-05T10:00:00.000Z' },
        aaa: {
          date: '2026-01-05',
          reflection: 'wrote it down',
          updated_at: '2026-01-05T09:00:00.000Z',
        },
      },
      dateOf
    )

    expect(unique[0].record.reflection).toBeNull()
  })

  it('merges through the read path, so a duplicated day keeps both edits', async () => {
    await seed(
      line('dailyEntry', 'eeee-old-uuid', {
        date: '2026-01-05',
        focus: 'seeded focus',
        updated_at: '2026-01-05T08:00:00.000Z',
      }),
      line('dailyEntry', 'zzzz-other-tab', {
        date: '2026-01-05',
        reflection: 'typed in the other tab',
        updated_at: '2026-01-05T09:00:00.000Z',
      })
    )

    const entry = await getDailyEntry('2026-01-05')
    expect(entry?.id).toBe('eeee-old-uuid')
    expect(entry?.focus).toBe('seeded focus')
    expect(entry?.reflection).toBe('typed in the other tab')

    const range = await getDailyDataRange('2026-01-01', '2026-01-31')
    expect(range.entries).toHaveLength(1)
    expect(range.entries[0].reflection).toBe('typed in the other tab')
  })

  it('never lets the local profile sentinel shadow a synced profile', async () => {
    // Every uuid sorts below 'profile', so lowest-id-wins would silently drop
    // whatever Settings wrote before the device had ever synced.
    await seed(
      line('profile', 'profile', {
        username: 'typed before the first sync',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      }),
      line('profile', 'ba1d1269-aa10-436b-bb42-c784c1fcbf17', {
        username: 'vats',
        ai_tone: 'wise',
        created_at: '2025-01-01T00:00:00.000Z',
      })
    )

    const profile = await getProfile()
    expect(profile.id).toBe('ba1d1269-aa10-436b-bb42-c784c1fcbf17')
    expect(profile.username).toBe('typed before the first sync')
    expect(profile.ai_tone).toBe('wise')

    // A later edit lands on the merged row, and has to win there — including
    // on a column the shadowed row also wrote, whose `created_at` is newer.
    const edited = await updateProfile({ ai_tone: 'friendly', username: 'renamed after the sync' })
    expect(edited.ai_tone).toBe('friendly')
    expect(edited.username).toBe('renamed after the sync')

    const reread = await getProfile()
    expect(reread.ai_tone).toBe('friendly')
    expect(reread.username).toBe('renamed after the sync')
  })
})

// --- id tie-breaks -----------------------------------------------------------

describe('rows that tie on every sort key fall back to the id', () => {
  it('orders identical tower items by id', async () => {
    await seed(
      line('towerItem', 't-z', {
        text: 'Z',
        status: 'active',
        expects_by: '2026-03-01',
        last_touched: '2026-01-01T00:00:00.000Z',
      }),
      line('towerItem', 't-a', {
        text: 'A',
        status: 'active',
        expects_by: '2026-03-01',
        last_touched: '2026-01-01T00:00:00.000Z',
      }),
      line('towerItem', 't-m', {
        text: 'M',
        status: 'active',
        expects_by: '2026-03-01',
        last_touched: '2026-01-01T00:00:00.000Z',
      })
    )

    expect((await getTowerItems()).map((item) => item.text)).toEqual(['A', 'M', 'Z'])
  })

  it('orders habits sharing one sort_order by id', async () => {
    await seed(
      line('habit', 'h-z', { label: 'Z', category: 'health', sort_order: 0 }),
      line('habit', 'h-a', { label: 'A', category: 'health', sort_order: 0 })
    )

    expect((await getHabits()).map((habit) => habit.label)).toEqual(['A', 'Z'])
  })
})

// --- a null timestamp is not the epoch ---------------------------------------

describe('a null timestamp keeps the end of the order the database put it at', () => {
  it('sorts a tower item with no last_touched last, not first', async () => {
    await seed(
      line('towerItem', 't-null', { text: 'never touched', status: 'active', last_touched: null }),
      line('towerItem', 't-old', {
        text: 'touched long ago',
        status: 'active',
        last_touched: '2020-01-01T00:00:00.000Z',
      })
    )

    expect((await getTowerItems()).map((item) => item.text)).toEqual([
      'touched long ago',
      'never touched',
    ])
  })

  it('sorts a pack with no created_at first, not last', async () => {
    await seed(
      line('pack', 'p-null', { label: 'undated', total: 5, created_at: null }),
      line('pack', 'p-dated', { label: 'dated', total: 5, created_at: '2026-01-03T00:00:00.000Z' })
    )

    expect((await getPacks()).map((pack) => pack.label)).toEqual(['undated', 'dated'])
  })
})

// --- the writes nothing used to import ---------------------------------------

describe('every write the contract has to preserve', () => {
  it('updateHabit changes what it was given and nothing else', async () => {
    const habit = await createHabit({
      label: 'Read',
      category: 'learning',
      description: 'ten pages',
    })

    const renamed = await updateHabit(habit.id, { label: 'Read more', emoji: '📖' })
    expect(renamed.label).toBe('Read more')
    expect(renamed.emoji).toBe('📖')
    expect(renamed.description).toBe('ten pages')
    expect(renamed.category).toBe('learning')
    expect(renamed.sort_order).toBe(habit.sort_order)
    expect(renamed.created_at).toBe(habit.created_at)
  })

  it('restoreHabit clears archived_at and brings the habit back', async () => {
    const habit = await createHabit({ label: 'Read', category: 'learning' })
    await deleteHabit(habit.id)
    expect(await getHabits()).toEqual([])

    const restored = await restoreHabit(habit.id)
    expect(restored.archived_at).toBeNull()
    expect(restored.label).toBe('Read')
    expect((await getHabits()).map((row) => row.id)).toEqual([habit.id])
  })

  it('reorderHabits writes each id the position it was handed', async () => {
    const a = await createHabit({ label: 'A', category: 'health' })
    const b = await createHabit({ label: 'B', category: 'health' })
    const c = await createHabit({ label: 'C', category: 'health' })
    expect((await getHabits()).map((row) => row.label)).toEqual(['A', 'B', 'C'])

    await reorderHabits([c.id, a.id, b.id])

    const reordered = await getHabits()
    expect(reordered.map((row) => row.label)).toEqual(['C', 'A', 'B'])
    expect(reordered.map((row) => row.sort_order)).toEqual([0, 1, 2])
  })

  it('updateTowerItem rewrites the fields and bumps last_touched', async () => {
    await seed(
      line('towerItem', 't-1', {
        text: 'call the plumber',
        status: 'active',
        effort: 'quick',
        last_touched: '2020-01-01T00:00:00.000Z',
        created_at: '2020-01-01T00:00:00.000Z',
      })
    )

    const updated = await updateTowerItem('t-1', { text: 'call the roofer', effort: 'deep' })
    expect(updated.text).toBe('call the roofer')
    expect(updated.effort).toBe('deep')
    expect(updated.status).toBe('active')
    expect(updated.createdAt).toBe('2020-01-01T00:00:00.000Z')
    expect(updated.lastTouched > '2020-01-01T00:00:00.000Z').toBe(true)
  })

  it('completeTowerItem sets status, done_at and last_touched together', async () => {
    await seed(
      line('towerItem', 't-1', {
        text: 'ship it',
        status: 'active',
        last_touched: '2020-01-01T00:00:00.000Z',
        created_at: '2020-01-01T00:00:00.000Z',
      })
    )

    const done = await completeTowerItem('t-1')
    expect(done.status).toBe('done')
    expect(done.doneAt).toBe(done.lastTouched)
    expect(done.lastTouched > '2020-01-01T00:00:00.000Z').toBe(true)

    expect(await getTowerItems()).toEqual([])
    expect((await getTowerItems(true)).map((item) => item.id)).toEqual(['t-1'])
  })

  it('updateProfile keeps the fields it was not handed', async () => {
    const first = await updateProfile({ username: 'vats', week_starts_on: 0 })
    expect(first.username).toBe('vats')
    expect(first.week_starts_on).toBe(0)
    expect(first.ai_tone).toBe('stoic')

    const second = await updateProfile({ ai_tone: 'wise' })
    expect(second.id).toBe(first.id)
    expect(second.ai_tone).toBe('wise')
    expect(second.username).toBe('vats')
    expect(second.week_starts_on).toBe(0)
    expect(second.created_at).toBe(first.created_at)

    expect((await getProfile()).ai_tone).toBe('wise')
  })

  it('updatePack changes the label and the total', async () => {
    const pack = await createPack({ label: 'Massage', total: 10 })

    const updated = await updatePack(pack.id, { label: 'Massages', total: 12 })
    expect(updated.label).toBe('Massages')
    expect(updated.total).toBe(12)
    expect(updated.createdAt).toBe(pack.createdAt)
    expect((await getPacks())[0].total).toBe(12)
  })

  it('updatePackSession changes only what it is handed', async () => {
    const pack = await createPack({ label: 'Massage', total: 10 })
    const session = await createPackSession({
      packId: pack.id,
      date: '2026-01-05',
      note: 'shoulders',
    })

    const moved = await updatePackSession(session.id, { date: '2026-01-06' })
    expect(moved.date).toBe('2026-01-06')
    expect(moved.note).toBe('shoulders')

    const cleared = await updatePackSession(session.id, { note: null })
    expect(cleared.note).toBeUndefined()
    expect(cleared.date).toBe('2026-01-06')
    expect((await getPackSessions(pack.id)).map((row) => row.date)).toEqual(['2026-01-06'])
  })
})

// --- writes against an id nothing answers to ---------------------------------

describe('a write against an id that does not exist creates nothing', () => {
  it('reorderHabits ignores an unknown id and leaves the rest alone', async () => {
    const habit = await createHabit({ label: 'Read', category: 'learning' })
    const queued = await outboxSize()

    await reorderHabits(['gone'])
    expect(entityIds('habit')).toEqual([habit.id])
    expect(await outboxSize()).toBe(queued)

    await reorderHabits(['gone', habit.id])
    expect(entityIds('habit')).toEqual([habit.id])
    expect((await getHabits())[0].sort_order).toBe(1)
  })

  it('createPackSession refuses a pack that is not there', async () => {
    await expect(createPackSession({ packId: 'gone', date: '2026-01-05' })).rejects.toThrow(
      'no matching record'
    )

    expect(entityIds('packSession')).toEqual([])
    expect(await outboxSize()).toBe(0)
  })
})

// --- today's MITs render in the order they were given ------------------------

describe('getDailyDataRange orders tasks the way the day is read', () => {
  it('follows sort_order rather than whatever the uuids sort to', async () => {
    await seed(
      line('task', 'zzz', { date: '2026-01-05', category: 'work', text: 'first', sort_order: 0 }),
      line('task', 'aaa', { date: '2026-01-05', category: 'work', text: 'second', sort_order: 1 }),
      line('task', 'mmm', { date: '2026-01-05', category: 'work', text: 'third', sort_order: 2 }),
      line('task', 'bbb', { date: '2026-01-06', category: 'self', text: 'tomorrow', sort_order: 0 })
    )

    const range = await getDailyDataRange('2026-01-01', '2026-01-31')
    expect(range.tasks.map((task) => task.text)).toEqual([
      'first',
      'second',
      'third',
      'tomorrow',
    ])

    // the same order the single-day and range readers already gave
    expect((await getTasks('2026-01-05')).map((task) => task.text)).toEqual([
      'first',
      'second',
      'third',
    ])
    expect((await getTasksRange('2026-01-01', '2026-01-31')).map((task) => task.text)).toEqual([
      'first',
      'second',
      'third',
      'tomorrow',
    ])
  })
})

// --- what the outbox ends up holding -----------------------------------------

describe('the outbox holds exactly one entry per event written', () => {
  it('counts one per write and nothing for a write with no drafts', async () => {
    const first = await createHabit({ label: 'A', category: 'health' })
    expect(await outboxSize()).toBe(1)

    const second = await createHabit({ label: 'B', category: 'health' })
    expect(await outboxSize()).toBe(2)

    // one event per habit moved
    await reorderHabits([second.id, first.id])
    expect(await outboxSize()).toBe(4)

    // toggling off a completion that was never on has nothing to write
    await toggleCompletion('h-1', '2026-01-05', false)
    expect(await outboxSize()).toBe(4)
  })
})

// --- the database failing under a write --------------------------------------

describe('a failure below the write path', () => {
  it('retries a hydrate that rejected instead of failing every later read', async () => {
    await seed(line('habit', 'h-1', { label: 'Read', category: 'learning', sort_order: 0 }))

    failures.allCachedFiles = true
    await expect(getHabits()).rejects.toThrow('the database is busy')

    // The cause cleared. A memoised rejection would fail this read too, and
    // every other read for the rest of the session.
    failures.allCachedFiles = false
    expect((await getHabits()).map((row) => row.label)).toEqual(['Read'])
  })

  it('does not reject a write whose event is already in the outbox', async () => {
    failures.setState = true

    // The caller reverts what it optimistically applied when this rejects, so
    // a throw here shows the owner a change flipping back that is on its way
    // to the journal regardless.
    const habit = await createHabit({ label: 'Read', category: 'learning' })

    expect(habit.label).toBe('Read')
    expect((await getHabits()).map((row) => row.id)).toEqual([habit.id])
    expect(await outboxSize()).toBe(1)
    expect(await getMeta<string>('lastBackupError')).toContain('the quota is exhausted')
  })

  it('still rejects a write that never reached the outbox', async () => {
    failures.enqueue = true

    await expect(createHabit({ label: 'Read', category: 'learning' })).rejects.toThrow(
      'the outbox is unavailable'
    )

    expect(await outboxSize()).toBe(0)
    expect(entityIds('habit')).toEqual([])
    expect(await getHabits()).toEqual([])
  })
})

// --- the session's own concurrency -------------------------------------------

describe('the session store serialises everything that touches it', () => {
  it('keeps every event when writes are started together', async () => {
    await Promise.all([
      createHabit({ label: 'A', category: 'health' }),
      createHabit({ label: 'B', category: 'health' }),
      createHabit({ label: 'C', category: 'health' }),
    ])

    expect(entityIds('habit')).toHaveLength(3)
    expect(await outboxSize()).toBe(3)
    expect((await getHabits()).map((row) => row.label).sort()).toEqual(['A', 'B', 'C'])
  })

  it('does not let a load in flight assign over a write', async () => {
    await seed(line('habit', 'h-1', { label: 'Seeded', category: 'health', sort_order: 0 }))

    // The load has read the device and is about to assign the whole array. A
    // write landing in that window is on the array it is about to replace.
    resetSession()
    const loading = latch()
    held.peekOutbox = loading
    const reload = hydrate()
    await loading.arrived

    // The write is held at the state write, which is the first point after it
    // has appended to the session. Getting that far while the load still has
    // its events in hand is the losing interleaving: the load then assigns an
    // array that never had this event in it.
    const writing_ = latch()
    held.setState = writing_
    const writing = commit([
      {
        entity: 'habit',
        entityId: 'h-2',
        type: 'upsert',
        fields: { label: 'Written', category: 'health', sort_order: 1 },
      },
    ])
    await Promise.race([writing_.arrived, new Promise((resolve) => setTimeout(resolve, 50))])

    loading.open()
    writing_.open()
    await reload
    await writing

    expect(entityIds('habit')).toEqual(['h-1', 'h-2'])
    expect((await getHabits()).map((row) => row.label)).toEqual(['Seeded', 'Written'])
  })

  it('lets a reset drop a load in flight rather than serving pre-reset data', async () => {
    await seed(line('habit', 'h-1', { label: 'Seeded', category: 'health', sort_order: 0 }))

    resetSession()
    const gate = latch()
    held.peekOutbox = gate
    const stale = hydrate()
    await gate.arrived

    resetSession()
    gate.open()
    await stale

    // The reset threw the session away; the load it interrupted must not put
    // it back. Reading again is a fresh load, which does see the journal.
    expect(currentState()).toEqual({})
    expect((await getHabits()).map((row) => row.label)).toEqual(['Seeded'])
  })
})
