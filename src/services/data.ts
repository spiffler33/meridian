/**
 * Data Service Layer
 *
 * The app's whole data API, served from the local journal. A read folds no
 * further than the session state already in memory; a write appends events to
 * the outbox and rebuilds that state. Nothing here talks to a network — the
 * outbox is where a change stops until the sync layer pushes it.
 *
 * Every exported name and signature is the one the views already call.
 */

import {
  commit,
  dailyEntryKey,
  ENTITY,
  habitCompletionKey,
  hydrate,
  newId,
  profileEntityId,
  readDailyEntries,
  readHabitCompletions,
  readHabits,
  readMergedDailyEntries,
  readMergedHabitCompletions,
  readMergedYearThemes,
  readPackRows,
  readPackSessionRows,
  readItemKey,
  readPulseRows,
  readProfile,
  readProfiles,
  readReadItemRows,
  readTasks,
  readTowerItemRows,
  readYearThemes,
  resolveEntityId,
  toPack,
  toPackSession,
  toProfile,
  toTowerItem,
  yearThemeKey,
} from '../lib/entities';
import type {
  DailyEntry,
  Habit,
  HabitCompletion,
  Profile,
  PulseRow,
  ReadItemRow,
  Task,
  TowerItemRow,
  YearTheme,
} from '../lib/entities';
import { allCachedFiles } from '../lib/db';
import type { HabitCategory, MitCategory, TowerStatus, TowerEffort, TowerItem, Pack, PackSession, PackWithCount } from '../types';

// ============================================================================
// Error Handling
// ============================================================================

class DataServiceError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DataServiceError';
    this.code = code;
  }
}

/**
 * The row a write just produced. A query that used to end in `.single()`
 * failed when it matched nothing, and so does this.
 */
function required<T>(row: T | undefined, what: string): T {
  if (row === undefined) {
    throw new DataServiceError(`Failed to ${what}: no matching record`, 'NOT_FOUND');
  }
  return row;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Ordering
// ============================================================================

/** Code-unit comparison, so every device orders a list the same way. */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Ascending, with nulls after every value — Postgres `ASC NULLS LAST`. */
function compareNullsLast(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compareText(a, b);
}

/** Descending, with nulls before every value — Postgres `DESC NULLS FIRST`. */
function compareDescNullsFirst(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;
  return compareText(b, a);
}

const dailyEntryKeyOf = (row: DailyEntry): string => dailyEntryKey(row.date);
const completionKeyOf = (row: HabitCompletion): string => habitCompletionKey(row.habit_id, row.date);
const yearThemeKeyOf = (row: YearTheme): string => yearThemeKey(row.year);

/** Inclusive on both ends, matching `.gte(start).lte(end)` on a YYYY-MM-DD column. */
function inRange(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

// ============================================================================
// Input Types
// ============================================================================

export interface HabitInput {
  label: string;
  description?: string | null;
  category: HabitCategory;
  emoji?: string | null;
}

export interface TaskInput {
  date: string;
  category: MitCategory;
  text: string;
  firstStep?: string | null;
}

export interface TowerItemInput {
  text: string;
  status?: TowerStatus;
  waitingOn?: string | null;
  expectsBy?: string | null;
  effort?: TowerEffort | null;
  isEvent?: boolean;
}

// ============================================================================
// Habits
// ============================================================================

/**
 * Get all habits for the current user (non-archived by default)
 */
export async function getHabits(includeArchived = false): Promise<Habit[]> {
  await hydrate();

  const rows = readHabits().filter((habit) => includeArchived || habit.archived_at === null);
  return rows.sort((a, b) => a.sort_order - b.sort_order || compareText(a.id, b.id));
}

/**
 * Create a new habit
 */
export async function createHabit(habit: HabitInput): Promise<Habit> {
  await hydrate();

  // Append at the end: one past the highest sort_order, archived ones included.
  const existing = readHabits();
  const nextSortOrder =
    existing.length > 0 ? Math.max(...existing.map((row) => row.sort_order)) + 1 : 0;

  const entityId = newId();
  await commit([
    {
      entity: ENTITY.habit,
      entityId,
      type: 'upsert',
      fields: {
        label: habit.label,
        description: habit.description ?? null,
        category: habit.category,
        emoji: habit.emoji ?? null,
        sort_order: nextSortOrder,
        created_at: nowIso(),
        archived_at: null,
      },
    },
  ]);

  return required(
    readHabits().find((row) => row.id === entityId),
    'create habit'
  );
}

/**
 * Update an existing habit
 */
export async function updateHabit(id: string, updates: Partial<Omit<Habit, 'id' | 'user_id' | 'created_at'>>): Promise<Habit> {
  await hydrate();

  required(
    readHabits().find((row) => row.id === id),
    'update habit'
  );
  await commit([{ entity: ENTITY.habit, entityId: id, type: 'upsert', fields: { ...updates } }]);

  return required(
    readHabits().find((row) => row.id === id),
    'update habit'
  );
}

/**
 * Delete a habit (soft delete by archiving)
 */
export async function deleteHabit(id: string): Promise<void> {
  await hydrate();

  // Archiving a habit that is not there updated no rows and raised nothing.
  if (!readHabits().some((row) => row.id === id)) return;

  await commit([
    { entity: ENTITY.habit, entityId: id, type: 'upsert', fields: { archived_at: nowIso() } },
  ]);
}

/**
 * Reorder habits by providing the new order of habit IDs
 */
export async function reorderHabits(habitIds: string[]): Promise<void> {
  await hydrate();

  // An id no habit answers to matched zero rows and updated nothing. Here the
  // same upsert would fold into a nameless habit the owner can see and never
  // get rid of. The surviving ids keep the positions they were handed, so
  // dropping one changes nobody else's order.
  const known = new Set(readHabits().map((row) => row.id));

  await commit(
    habitIds
      .map((id, index) => ({
        entity: ENTITY.habit,
        entityId: id,
        type: 'upsert' as const,
        fields: { sort_order: index },
      }))
      .filter((draft) => known.has(draft.entityId))
  );
}

// ============================================================================
// Daily Entries (focus + reflection)
// ============================================================================

/**
 * Get the daily entry for a specific date
 */
export async function getDailyEntry(date: string): Promise<DailyEntry | null> {
  await hydrate();

  const rows = readMergedDailyEntries();
  return rows.find((row) => row.date === date) ?? null;
}

/**
 * Create or update a daily entry
 */
export async function upsertDailyEntry(
  date: string,
  data: { focus?: string; reflection?: string; isHoliday?: boolean }
): Promise<DailyEntry> {
  await hydrate();

  // One entity per date, whatever id that date's row already has.
  const rows = readDailyEntries();
  const entityId = resolveEntityId(rows, dailyEntryKeyOf, dailyEntryKey(date));
  const existing = rows.some((row) => row.id === entityId);

  // Only the fields that were passed, so an upsert never blanks the others.
  const now = nowIso();
  const fields: Record<string, unknown> = { date, updated_at: now };
  if (!existing) fields.created_at = now;
  if (data.focus !== undefined) fields.focus = data.focus;
  if (data.reflection !== undefined) fields.reflection = data.reflection;
  if (data.isHoliday !== undefined) fields.is_holiday = data.isHoliday;

  await commit([{ entity: ENTITY.dailyEntry, entityId, type: 'upsert', fields }]);

  return required(
    readDailyEntries().find((row) => row.id === entityId),
    'upsert daily entry'
  );
}

// ============================================================================
// Habit Completions
// ============================================================================

/**
 * Get all habit completions within a date range
 */
export async function getCompletions(startDate: string, endDate: string): Promise<HabitCompletion[]> {
  await hydrate();

  return readMergedHabitCompletions()
    .filter((row) => inRange(row.date, startDate, endDate))
    .sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id));
}

/**
 * Get habit completions for a specific date as a map of habitId -> completed
 */
export async function getCompletionsForDate(date: string): Promise<Record<string, boolean>> {
  await hydrate();

  // Presence indicates completion.
  const completions: Record<string, boolean> = {};
  for (const row of readHabitCompletions()) {
    if (row.date === date) completions[row.habit_id] = true;
  }

  return completions;
}

/**
 * Toggle a habit completion for a specific date
 */
export async function toggleCompletion(
  habitId: string,
  date: string,
  completed: boolean
): Promise<void> {
  await hydrate();

  const rows = readHabitCompletions();
  const key = habitCompletionKey(habitId, date);

  if (completed) {
    // One entity per (habit, date): toggling the same day twice writes the
    // same entity rather than a second completion.
    const entityId = resolveEntityId(rows, completionKeyOf, key);
    const fields: Record<string, unknown> = { habit_id: habitId, date };
    if (!rows.some((row) => row.id === entityId)) fields.created_at = nowIso();

    await commit([{ entity: ENTITY.habitCompletion, entityId, type: 'upsert', fields }]);
    return;
  }

  // The delete removed every row for that habit and date, not just one.
  await commit(
    rows
      .filter((row) => completionKeyOf(row) === key)
      .map((row) => ({ entity: ENTITY.habitCompletion, entityId: row.id, type: 'delete' as const }))
  );
}

// ============================================================================
// Tasks (MITs)
// ============================================================================

/**
 * Reading order for a span of days: date, then category, then the position the
 * owner dragged the task to. Skipping `sort_order` would leave the list in
 * whatever order the uuids happened to fall in, which is the order the MITs
 * render in — so `createTask`'s max + 1 has to be honoured by every reader,
 * not just the one the views happen to call first.
 */
function compareTasks(a: Task, b: Task): number {
  return (
    compareText(a.date, b.date) ||
    compareText(a.category, b.category) ||
    a.sort_order - b.sort_order ||
    compareText(a.id, b.id)
  );
}

/**
 * Get all tasks for a specific date
 */
export async function getTasks(date: string): Promise<Task[]> {
  await hydrate();

  return readTasks()
    .filter((row) => row.date === date)
    .sort(
      (a, b) =>
        compareText(a.category, b.category) ||
        a.sort_order - b.sort_order ||
        compareText(a.id, b.id)
    );
}

/**
 * Get all tasks within a date range
 */
export async function getTasksRange(startDate: string, endDate: string): Promise<Task[]> {
  await hydrate();

  return readTasks()
    .filter((row) => inRange(row.date, startDate, endDate))
    .sort(compareTasks);
}

/**
 * Create a new task
 */
export async function createTask(task: TaskInput): Promise<Task> {
  await hydrate();

  // Append at the end of this date's category, not of the whole day.
  const siblings = readTasks().filter(
    (row) => row.date === task.date && row.category === task.category
  );
  const nextSortOrder =
    siblings.length > 0 ? Math.max(...siblings.map((row) => row.sort_order)) + 1 : 0;

  const entityId = newId();
  await commit([
    {
      entity: ENTITY.task,
      entityId,
      type: 'upsert',
      fields: {
        date: task.date,
        category: task.category,
        text: task.text,
        first_step: task.firstStep ?? null,
        sort_order: nextSortOrder,
        completed: false,
        created_at: nowIso(),
        completed_at: null,
      },
    },
  ]);

  return required(
    readTasks().find((row) => row.id === entityId),
    'create task'
  );
}

/**
 * Update an existing task
 */
export async function updateTask(
  id: string,
  updates: Partial<Omit<Task, 'id' | 'user_id' | 'created_at'>>
): Promise<Task> {
  await hydrate();

  required(
    readTasks().find((row) => row.id === id),
    'update task'
  );

  // If marking as completed, set completed_at timestamp
  const updateData: Partial<Task> = { ...updates };
  if (updates.completed === true && !updates.completed_at) {
    updateData.completed_at = nowIso();
  } else if (updates.completed === false) {
    updateData.completed_at = null;
  }

  await commit([{ entity: ENTITY.task, entityId: id, type: 'upsert', fields: { ...updateData } }]);

  return required(
    readTasks().find((row) => row.id === id),
    'update task'
  );
}

/**
 * Delete a task
 */
export async function deleteTask(id: string): Promise<void> {
  await hydrate();

  if (!readTasks().some((row) => row.id === id)) return;
  await commit([{ entity: ENTITY.task, entityId: id, type: 'delete' }]);
}

// ============================================================================
// Year Themes
// ============================================================================

/**
 * Get the theme for a specific year
 */
export async function getYearTheme(year: number): Promise<string | null> {
  await hydrate();

  const row = readMergedYearThemes().find((candidate) => candidate.year === year);
  return row?.theme ?? null;
}

/**
 * Set the theme for a specific year
 */
export async function setYearTheme(year: number, theme: string): Promise<void> {
  await hydrate();

  // One entity per year, whatever id that year's row already has.
  const entityId = resolveEntityId(readYearThemes(), yearThemeKeyOf, yearThemeKey(year));
  await commit([{ entity: ENTITY.yearTheme, entityId, type: 'upsert', fields: { year, theme } }]);
}

// ============================================================================
// Profile
// ============================================================================

/**
 * Get the current user's profile
 */
export async function getProfile(): Promise<Profile> {
  await hydrate();

  // A device that has never written a profile still has one, with the column
  // defaults the table used to fill in.
  return readProfile() ?? toProfile(profileEntityId(), {});
}

/**
 * Update the current user's profile
 */
export async function updateProfile(
  updates: Partial<Omit<Profile, 'id' | 'created_at'>>
): Promise<Profile> {
  await hydrate();

  const entityId = profileEntityId();
  const now = nowIso();
  // Stamped on every write so the singleton merge can tell which of two rows
  // was written last. Without it the row with the newest `created_at` — the
  // one a fresh device made before its first sync — would shadow every later
  // edit that lands on the other row, forever.
  const fields: Record<string, unknown> = { ...updates, updated_at: now };
  if (!readProfiles().some((row) => row.id === entityId)) fields.created_at = now;

  await commit([{ entity: ENTITY.profile, entityId, type: 'upsert', fields }]);

  // The merged singleton, not the raw row this write landed on, so what comes
  // back is what the next `getProfile` will say.
  return required(readProfile() ?? undefined, 'update profile');
}

// ============================================================================
// Reading
// ============================================================================

export { readItemKey };

/** Every item marked read, on every surface. */
export async function getReadItems(): Promise<ReadItemRow[]> {
  await hydrate();
  return readReadItemRows();
}

/**
 * Mark one item read, or unmark it.
 *
 * Unmarking is a tombstone rather than a flag, so a device that never saw the
 * mark and a device that saw it and cleared it end at the same answer. Marking
 * again resurrects the entity, carrying only what is written after the delete —
 * which is the whole record here.
 */
export async function setItemRead(key: string, read: boolean): Promise<void> {
  await hydrate();
  await commit([
    read
      ? { entity: ENTITY.readItem, entityId: key, type: 'upsert', fields: { read_at: nowIso() } }
      : { entity: ENTITY.readItem, entityId: key, type: 'delete' },
  ]);
}

/** The reading baseline, or null on a device that has never established one. */
export async function getReadingBaseline(): Promise<string | null> {
  await hydrate();
  return readProfile()?.reading_baseline_at ?? null;
}

/**
 * Establish the reading baseline, once, ever.
 *
 * One event, not three hundred and twenty-six: everything the corpus published
 * before this mark was already read in email, and the pane opens showing the
 * handful since rather than the whole library in alarm.
 *
 * Two guards, and the second is the one that matters. Writing only when unset
 * is not enough on its own — a second device that has not yet pulled the
 * journal would see no baseline, stamp a NEWER one, and last-writer-wins would
 * silently mark every entry between the two as read. So a device that has
 * never seen the journal does not get to decide: it has no way to know whether
 * a baseline already exists, and it will have one within a sync.
 *
 * Returns the baseline in force, or null when none could be established yet.
 */
export async function ensureReadingBaseline(): Promise<string | null> {
  const existing = await getReadingBaseline();
  if (existing !== null) return existing;

  const seen = await allCachedFiles();
  if (seen.length === 0) return null;

  const now = nowIso();
  await updateProfile({ reading_baseline_at: now });
  return now;
}

// ============================================================================
// Pulse
// ============================================================================

/** Every pulse ever captured. The day filter is the caller's — see lib/pulse. */
export async function getPulses(): Promise<PulseRow[]> {
  await hydrate();
  return readPulseRows();
}

/**
 * Capture one pulse.
 *
 * Two fields, both written once and never again: the text as the owner typed
 * it, and the instant. Nothing else — the coder's derived fields arrive in
 * phase 2 as a separate upsert that must not carry `text`, which is what makes
 * field-level last-writer-wins unable to clobber a verbatim line.
 *
 * The text is stored with surrounding whitespace removed and nothing else
 * touched. A trailing space is a keyboard artefact rather than an utterance;
 * the fence is on rewriting meaning, and there is none in it.
 *
 * No network stands between this and a saved line: `commit` writes the outbox
 * and rebuilds state, and the push happens later, or tomorrow, or never
 * without the line being lost.
 */
export async function createPulse(text: string): Promise<PulseRow> {
  await hydrate();

  const entityId = newId();
  await commit([
    {
      entity: ENTITY.pulse,
      entityId,
      type: 'upsert',
      fields: { text: text.trim(), at: nowIso() },
    },
  ]);

  return required(
    readPulseRows().find((row) => row.id === entityId),
    'create pulse'
  );
}

/**
 * Delete one pulse.
 *
 * A tombstone, like every other delete here: the line is gone on every device
 * that folds it, and the journal still holds what was said. There is no edit —
 * delete and retype is the whole edit story, which keeps "verbatim" a property
 * of the record rather than a promise about a code path.
 */
export async function deletePulse(id: string): Promise<void> {
  await hydrate();
  await commit([{ entity: ENTITY.pulse, entityId: id, type: 'delete' }]);
}

// ============================================================================
// Bulk Data Loading
// ============================================================================

/**
 * Load all data needed for app initialization
 */
export async function loadAllData(): Promise<{
  habits: Habit[];
  profile: Profile;
}> {
  await hydrate();

  const [habits, profile] = await Promise.all([getHabits(), getProfile()]);
  return { habits, profile };
}

// ============================================================================
// Analytics Helper
// ============================================================================

/**
 * Get all daily data for a date range (for analytics)
 */
export async function getDailyDataRange(
  startDate: string,
  endDate: string
): Promise<{
  entries: DailyEntry[];
  completions: HabitCompletion[];
  tasks: Task[];
}> {
  await hydrate();

  const entries = readMergedDailyEntries()
    .filter((row) => inRange(row.date, startDate, endDate))
    .sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id));

  const completions = readMergedHabitCompletions()
    .filter((row) => inRange(row.date, startDate, endDate))
    .sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id));

  const tasks = readTasks()
    .filter((row) => inRange(row.date, startDate, endDate))
    .sort(compareTasks);

  return { entries, completions, tasks };
}

// ============================================================================
// Additional Utility Functions
// ============================================================================

/**
 * Get all year themes for the current user
 */
export async function getAllYearThemes(): Promise<YearTheme[]> {
  await hydrate();

  return readMergedYearThemes().sort(
    (a, b) => b.year - a.year || compareText(a.id, b.id)
  );
}

/**
 * Delete a year theme
 */
export async function deleteYearTheme(year: number): Promise<void> {
  await hydrate();

  await commit(
    readYearThemes()
      .filter((row) => row.year === year)
      .map((row) => ({ entity: ENTITY.yearTheme, entityId: row.id, type: 'delete' as const }))
  );
}

/**
 * Restore an archived habit
 */
export async function restoreHabit(id: string): Promise<Habit> {
  await hydrate();

  required(
    readHabits().find((row) => row.id === id),
    'restore habit'
  );
  await commit([
    { entity: ENTITY.habit, entityId: id, type: 'upsert', fields: { archived_at: null } },
  ]);

  return required(
    readHabits().find((row) => row.id === id),
    'restore habit'
  );
}

/**
 * Get streak information for a habit
 * Returns the current streak and longest streak
 */
export async function getHabitStreak(habitId: string): Promise<{ current: number; longest: number }> {
  await hydrate();

  const data = readMergedHabitCompletions().filter(
    (row) => row.habit_id === habitId
  );

  if (data.length === 0) {
    return { current: 0, longest: 0 };
  }

  const dates = data.map(d => d.date).sort((a, b) => b.localeCompare(a));
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  // Check if streak is current (today or yesterday)
  const isCurrentStreak = dates[0] === today || dates[0] === yesterday;

  for (let i = 0; i < dates.length; i++) {
    if (i === 0) {
      tempStreak = 1;
      continue;
    }

    const prevDate = new Date(dates[i - 1]);
    const currDate = new Date(dates[i]);
    const diffDays = Math.floor((prevDate.getTime() - currDate.getTime()) / 86400000);

    if (diffDays === 1) {
      tempStreak++;
    } else {
      if (i === 1 && isCurrentStreak) {
        currentStreak = 1; // Streak broken, only today/yesterday counts
      }
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }

  longestStreak = Math.max(longestStreak, tempStreak);

  if (isCurrentStreak && currentStreak === 0) {
    currentStreak = tempStreak;
  }

  return { current: currentStreak, longest: longestStreak };
}

/**
 * Get all completion dates for a habit
 * Returns an array of date strings (YYYY-MM-DD)
 */
export async function getHabitCompletionDates(habitId: string): Promise<string[]> {
  await hydrate();

  return readMergedHabitCompletions()
    .filter((row) => row.habit_id === habitId)
    .sort((a, b) => compareText(b.date, a.date) || compareText(a.id, b.id))
    .map((row) => row.date);
}

// ============================================================================
// Tower Items
// ============================================================================

/**
 * Surfacing order: expects_by ASC (nulls last), then last_touched ASC (oldest
 * first). The tower's whole point is what it puts at the top, so the nulls-last
 * half matters as much as the ascending half.
 */
function compareTowerItems(a: TowerItemRow, b: TowerItemRow): number {
  return (
    compareNullsLast(a.expects_by, b.expects_by) ||
    compareNullsLast(a.last_touched, b.last_touched) ||
    compareText(a.id, b.id)
  );
}

/**
 * Get all tower items for the current user (excludes done by default)
 */
export async function getTowerItems(includeDone = false): Promise<TowerItem[]> {
  await hydrate();

  return readTowerItemRows()
    .filter((row) => includeDone || row.status !== 'done')
    .sort(compareTowerItems)
    .map(toTowerItem);
}

/**
 * Get tower items by status
 */
export async function getTowerItemsByStatus(status: TowerStatus): Promise<TowerItem[]> {
  await hydrate();

  return readTowerItemRows()
    .filter((row) => row.status === status)
    .sort(compareTowerItems)
    .map(toTowerItem);
}

/**
 * Create a new tower item
 */
export async function createTowerItem(item: TowerItemInput): Promise<TowerItem> {
  await hydrate();

  const entityId = newId();
  const now = nowIso();
  await commit([
    {
      entity: ENTITY.towerItem,
      entityId,
      type: 'upsert',
      fields: {
        text: item.text,
        status: item.status ?? 'active',
        waiting_on: item.waitingOn ?? null,
        expects_by: item.expectsBy ?? null,
        effort: item.effort ?? null,
        is_event: item.isEvent ?? false,
        last_touched: now,
        created_at: now,
        done_at: null,
      },
    },
  ]);

  return toTowerItem(
    required(
      readTowerItemRows().find((row) => row.id === entityId),
      'create tower item'
    )
  );
}

/**
 * Update a tower item
 */
export async function updateTowerItem(
  id: string,
  updates: Partial<TowerItemInput>
): Promise<TowerItem> {
  await hydrate();

  required(
    readTowerItemRows().find((row) => row.id === id),
    'update tower item'
  );

  // Any touch counts as attention: the surfacing order depends on it.
  const fields: Record<string, unknown> = { last_touched: nowIso() };
  if (updates.text !== undefined) fields.text = updates.text;
  if (updates.status !== undefined) fields.status = updates.status;
  if (updates.waitingOn !== undefined) fields.waiting_on = updates.waitingOn;
  if (updates.expectsBy !== undefined) fields.expects_by = updates.expectsBy;
  if (updates.effort !== undefined) fields.effort = updates.effort;
  if (updates.isEvent !== undefined) fields.is_event = updates.isEvent;

  await commit([{ entity: ENTITY.towerItem, entityId: id, type: 'upsert', fields }]);

  return toTowerItem(
    required(
      readTowerItemRows().find((row) => row.id === id),
      'update tower item'
    )
  );
}

/**
 * Mark a tower item as done
 */
export async function completeTowerItem(id: string): Promise<TowerItem> {
  await hydrate();

  required(
    readTowerItemRows().find((row) => row.id === id),
    'complete tower item'
  );

  const now = nowIso();
  await commit([
    {
      entity: ENTITY.towerItem,
      entityId: id,
      type: 'upsert',
      fields: { status: 'done', done_at: now, last_touched: now },
    },
  ]);

  return toTowerItem(
    required(
      readTowerItemRows().find((row) => row.id === id),
      'complete tower item'
    )
  );
}

/**
 * Delete a tower item permanently
 */
export async function deleteTowerItem(id: string): Promise<void> {
  await hydrate();

  if (!readTowerItemRows().some((row) => row.id === id)) return;
  await commit([{ entity: ENTITY.towerItem, entityId: id, type: 'delete' }]);
}

// ============================================================================
// Packs
// ============================================================================

export interface PackInput {
  label: string;
  total: number;
}

export interface PackSessionInput {
  packId: string;
  date: string;
  note?: string | null;
}

/**
 * Get all packs for the current user (non-archived by default)
 * Returns packs with their used count
 */
export async function getPacks(includeArchived = false): Promise<PackWithCount[]> {
  await hydrate();

  // The count came back from the database as an embedded aggregate; here it is
  // one pass over the sessions.
  const used = new Map<string, number>();
  for (const session of readPackSessionRows()) {
    used.set(session.pack_id, (used.get(session.pack_id) ?? 0) + 1);
  }

  return readPackRows()
    .filter((row) => includeArchived || row.archived_at === null)
    .sort((a, b) => compareDescNullsFirst(a.created_at, b.created_at) || compareText(a.id, b.id))
    .map((row) => ({ ...toPack(row), used: used.get(row.id) ?? 0 }));
}

/**
 * Create a new pack
 */
export async function createPack(pack: PackInput): Promise<Pack> {
  await hydrate();

  const entityId = newId();
  await commit([
    {
      entity: ENTITY.pack,
      entityId,
      type: 'upsert',
      fields: {
        label: pack.label,
        total: pack.total,
        created_at: nowIso(),
        archived_at: null,
      },
    },
  ]);

  return toPack(
    required(
      readPackRows().find((row) => row.id === entityId),
      'create pack'
    )
  );
}

/**
 * Update a pack
 */
export async function updatePack(
  id: string,
  updates: Partial<PackInput>
): Promise<Pack> {
  await hydrate();

  required(
    readPackRows().find((row) => row.id === id),
    'update pack'
  );
  await commit([{ entity: ENTITY.pack, entityId: id, type: 'upsert', fields: { ...updates } }]);

  return toPack(
    required(
      readPackRows().find((row) => row.id === id),
      'update pack'
    )
  );
}

/**
 * Archive a pack (soft delete)
 */
export async function archivePack(id: string): Promise<void> {
  await hydrate();

  if (!readPackRows().some((row) => row.id === id)) return;
  await commit([
    { entity: ENTITY.pack, entityId: id, type: 'upsert', fields: { archived_at: nowIso() } },
  ]);
}

/**
 * Get all sessions for a pack
 */
export async function getPackSessions(packId: string): Promise<PackSession[]> {
  await hydrate();

  return readPackSessionRows()
    .filter((row) => row.pack_id === packId)
    .sort((a, b) => compareText(b.date, a.date) || compareText(a.id, b.id))
    .map(toPackSession);
}

/**
 * Log a new session for a pack
 */
export async function createPackSession(session: PackSessionInput): Promise<PackSession> {
  await hydrate();

  // A foreign key stood here. Without one, a session logged against a pack
  // that is not there counts towards nothing and is reachable from nowhere.
  required(
    readPackRows().find((row) => row.id === session.packId),
    'create pack session'
  );

  const entityId = newId();
  await commit([
    {
      entity: ENTITY.packSession,
      entityId,
      type: 'upsert',
      fields: {
        pack_id: session.packId,
        date: session.date,
        note: session.note ?? null,
        created_at: nowIso(),
      },
    },
  ]);

  return toPackSession(
    required(
      readPackSessionRows().find((row) => row.id === entityId),
      'create pack session'
    )
  );
}

/**
 * Update a pack session
 */
export async function updatePackSession(
  id: string,
  updates: { date?: string; note?: string | null }
): Promise<PackSession> {
  await hydrate();

  required(
    readPackSessionRows().find((row) => row.id === id),
    'update pack session'
  );

  const fields: Record<string, unknown> = {};
  if (updates.date !== undefined) fields.date = updates.date;
  if (updates.note !== undefined) fields.note = updates.note;

  await commit([{ entity: ENTITY.packSession, entityId: id, type: 'upsert', fields }]);

  return toPackSession(
    required(
      readPackSessionRows().find((row) => row.id === id),
      'update pack session'
    )
  );
}

/**
 * Delete a pack session
 */
export async function deletePackSession(id: string): Promise<void> {
  await hydrate();

  if (!readPackSessionRows().some((row) => row.id === id)) return;
  await commit([{ entity: ENTITY.packSession, entityId: id, type: 'delete' }]);
}

// Re-export types for convenience
export type { Habit, DailyEntry, HabitCompletion, Task, YearTheme, Profile, TowerItemRow } from '../lib/entities';
