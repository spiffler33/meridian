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
  PULSE_EFFECT_TYPES,
  PULSE_VOCAB_ID,
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
  readPulseVocabRow,
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
  TOWER_STATUSES,
  yearThemeKey,
} from '../lib/entities';
import type {
  DailyEntry,
  EventDraft,
  Habit,
  HabitCompletion,
  Profile,
  PulseEffect,
  PulseEffectType,
  PulseLinks,
  PulseRow,
  PulseVocabProposal,
  PulseVocabRow,
  ReadItemRow,
  Task,
  TowerItemRow,
  YearTheme,
} from '../lib/entities';
import { allCachedFiles, getMeta, setMeta } from '../lib/db';
import type { MetaKey } from '../lib/db';
import { dayKey, deviceTimeZone, eventsForDay } from '../lib/calendar';
import { loadCalendar } from '../lib/calendarSync';
import { compareOldestFirst, effectKey, effectString, spawnTaskText } from '../lib/pulse';
import { scheduleFlush } from '../lib/sync';
import { codePulse } from './coder';
import type { Coding, CoderContext, PulseEnrichment, RecentPulse } from './coder';
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

/**
 * Write the coder's derived fields to a pulse.
 *
 * Carries neither `text` nor `at` (fence 1): field-level last-writer-wins
 * then cannot clobber the verbatim line no matter when this lands — including
 * after the pulse has been deleted. An enrichment landing after a delete
 * resurrects the pulse carrying only these fields, so `text` falls back to
 * `''`; that is pinned behaviour in `pulse.test.ts`, not a bug this guards
 * against (P2), and this function does not check whether the pulse still
 * exists before writing.
 *
 * No read-back. `createPulse`'s read-and-throw-`NOT_FOUND` is a live hazard
 * here, not a check: a concurrent `resetSession()` (a pull landing mid-call)
 * can leave this event durably enqueued without applying it to the current
 * session (L4), and that is fine as-is — the event is safe, and the next read
 * sees it.
 *
 * `links` is the one field this MERGES rather than replaces (see `mergeLinks`),
 * and the read it needs is why this queues with the chip applies: the same
 * field is read-modify-written on both paths.
 */
export async function enrichPulse(id: string, coding: Coding): Promise<void> {
  return serializePulseWrite(async () => {
    await hydrate();
    // Every field of the coding except the two fence 1 forbids. `effects` and
    // `vocabProposal` are stored rather than held in memory: a coded pulse is
    // invisible to the sweep forever, so a proposal that lived only in the
    // sweep's local variable could never be regenerated, and Appendix C's
    // "dismiss drops the effect, keeps the coding" needs it to survive a reload.
    const fields: Coding = {
      signal: coding.signal,
      domain: coding.domain,
      activity: coding.activity,
      people: coding.people,
      span: coding.span,
      links: mergeLinks(readPulseRows().find((row) => row.id === id)?.links, coding.links),
      effects: coding.effects,
      vocabProposal: coding.vocabProposal,
    };
    await commit([{ entity: ENTITY.pulse, entityId: id, type: 'upsert', fields }]);
  });
}

/**
 * The coder's `links`, with anything already recorded on the row left alone.
 *
 * A chip apply records a FACT — this pulse spawned that task, this pulse
 * claimed that event. An enrichment only PROPOSES, and a recorded fact
 * outranks a fresh proposal. The other device re-coding a pulse whose
 * enrichment has not reached it yet answers with all-null links, and writing
 * those wholesale would erase the fact and re-arm `spawnTask`'s own guard —
 * a second Tower item for a task the owner spawned exactly once.
 *
 * So a sub-key already holding a value survives and only the nulls are filled
 * from the coding. A row that does not exist has nothing to keep: an
 * enrichment landing after a delete resurrects the pulse carrying the coding's
 * own links, which is the pinned behaviour (P2), unchanged.
 */
function mergeLinks(existing: PulseLinks | undefined, proposed: PulseLinks): PulseLinks {
  if (existing === undefined) return proposed;
  return {
    habitId: existing.habitId ?? proposed.habitId,
    towerId: existing.towerId ?? proposed.towerId,
    eventId: existing.eventId ?? proposed.eventId,
  };
}

// ============================================================================
// Pulse vocabulary
// ============================================================================

const PULSE_VOCAB_SEED_DOMAINS = ['db', 'hoa', 'family', 'home-ops', 'self', 'social', 'transit', 'admin'];

const PULSE_VOCAB_SEED_ACTIVITIES: Record<string, string> = {
  gym: 'self',
  read: 'self',
  'deep-work': 'db',
  'school-run': 'family',
  dinner: 'family',
  drinks: 'social',
};

const PULSE_VOCAB_SEED_PEOPLE = ['wife', 'kids'];

/**
 * The one live habit whose label exactly matches `label`, case-insensitively.
 * Not a keyword search over pulse text — a one-time lookup, at seed time
 * only, against the owner's own small and closed set of configured habits.
 */
function habitIdByLabel(habits: readonly Habit[], label: string): string | undefined {
  const target = label.trim().toLowerCase();
  return habits.find((habit) => habit.label.trim().toLowerCase() === target)?.id;
}

/**
 * `habitAliases` per Appendix A: `gym`/`lift`/`strength` all point at the
 * strength habit, `read` at the reading habit. An alias with no matching
 * habit is omitted rather than guessed — the vocabulary grows via approved
 * `vocabProposal` chips later, so an incomplete seed is recoverable and a
 * wrong guess would not be.
 */
function seedHabitAliases(habits: readonly Habit[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  const strengthId = habitIdByLabel(habits, 'strength');
  if (strengthId !== undefined) {
    aliases.gym = strengthId;
    aliases.lift = strengthId;
    aliases.strength = strengthId;
  }
  const readingId = habitIdByLabel(habits, 'reading');
  if (readingId !== undefined) aliases.read = readingId;
  return aliases;
}

/**
 * Fill in `habitAliases` when the seed could not.
 *
 * The seed resolves aliases against the habits that exist at that moment, and
 * omits rather than guesses. An owner whose habits are not labelled exactly
 * `strength`/`reading`, or who creates them after the first pulse is coded,
 * would otherwise carry `habitAliases: {}` permanently — the seed never runs
 * again, and phase 3's habit-timing histogram reads nothing but that map.
 *
 * Only ever from empty, so it is idempotent and cannot overwrite an alias the
 * owner approved through a chip: once anything is in there, this is a no-op
 * forever. Still omits rather than guesses — a habit whose label matches
 * nothing simply leaves the map empty and the repair re-attempts next time.
 */
async function repairHabitAliases(existing: PulseVocabRow): Promise<PulseVocabRow> {
  if (Object.keys(existing.habitAliases).length > 0) return existing;

  const habitAliases = seedHabitAliases(await getHabits());
  if (Object.keys(habitAliases).length === 0) return existing;

  await commit([{ entity: ENTITY.pulseVocab, entityId: PULSE_VOCAB_ID, type: 'upsert', fields: { habitAliases } }]);
  return readPulseVocabRow() ?? { ...existing, habitAliases };
}

/**
 * Seed `pulseVocab`, once, iff unset — one journal event. Idempotent: a
 * device that finds a row already there writes nothing, and two devices
 * racing to seed both write the same literal content to the same fixed id
 * (`PULSE_VOCAB_ID`), so the fold converges to one result either way rather
 * than forking.
 */
export async function ensurePulseVocabSeeded(): Promise<PulseVocabRow> {
  await hydrate();
  const existing = readPulseVocabRow();
  if (existing !== null) return repairHabitAliases(existing);

  const habits = await getHabits();
  const seedFields = {
    domains: PULSE_VOCAB_SEED_DOMAINS,
    activities: PULSE_VOCAB_SEED_ACTIVITIES,
    people: PULSE_VOCAB_SEED_PEOPLE,
    habitAliases: seedHabitAliases(habits),
  };

  await commit([{ entity: ENTITY.pulseVocab, entityId: PULSE_VOCAB_ID, type: 'upsert', fields: seedFields }]);

  // A concurrent resetSession() can leave the event enqueued but not applied
  // to this session (L4) — the same tolerance enrichPulse extends. What is
  // durably queued is exactly seedFields, so handing that back is not a guess.
  return readPulseVocabRow() ?? { id: PULSE_VOCAB_ID, ...seedFields };
}

// ============================================================================
// Pulse proposals (chips)
// ============================================================================

/**
 * The one rule this whole section is built around: **an apply is a single
 * `commit`.**
 *
 * Applying touches two things — the entity the effect names, and the pulse's
 * own `effects` list, which the applied effect has to leave. Split across two
 * commits, a failure between them leaves the chip on screen with the write
 * already done, and the next tap repeats it. Three of the four effects would
 * survive that (a habit completion is keyed `habit+date`, a claim writes the
 * same id, an update rewrites the same fields), but `spawnTask` mints a fresh
 * id and would make a second Tower item the owner never asked for.
 *
 * `commit` takes an array and turns it into one `enqueue` (`entities.ts`), so
 * both writes land or neither does. Nothing here calls `createTowerItem` or
 * `toggleCompletion`: each of those is its own `commit`, which is exactly the
 * split this must not have. The fields they write are mirrored instead, which
 * is the one duplication this design pays for.
 *
 * `spawnTask` is guarded on top of that: a pulse whose `links.towerId` is
 * already set has its task, so the chip is dropped and nothing is created.
 */

/** No link at all — what a pulse coded before `links` existed reads as. */
const NO_LINKS: PulseLinks = { habitId: null, towerId: null, eventId: null };

/**
 * Every read-modify-write of a pulse's own `effects` and `links` runs one at
 * a time.
 *
 * Both fields are written whole: an apply rewrites the effects list without
 * the one it took, and sets a link beside whatever was already there. Run
 * concurrently — two chips tapped in the same second, or a tap landing while
 * the auto-apply pass walks a fresh coding's own effects — the second write
 * is built from a row read before the first one landed, and the first's work
 * is simply overwritten. Measured: `claimEvent` and `spawnTask` applied
 * together left `links.eventId` null and the claim's chip back on screen,
 * which phase 3's Needed-vs-Spent reads as "never claimed".
 *
 * The lock lives here rather than in the hook because the background
 * auto-apply path never goes near the hook, and a lock only one of the two
 * paths takes is not a lock. Same promise-chain shape as `entities.ts`'s
 * `serialize` and `sync.ts`'s `serialized`, for the same reason.
 */
let pulseWriteQueue: Promise<void> = Promise.resolve();

function serializePulseWrite<T>(work: () => Promise<T>): Promise<T> {
  const run = pulseWriteQueue.then(work);
  // The queue itself must never reject: one failed apply cannot be allowed to
  // fail every apply queued behind it.
  pulseWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Watchers of a write this layer made that `AppContext` cannot know about.
 *
 * Two paths reach it. A chip apply writes a `towerItem` or a `habitCompletion`
 * beside the pulse's own update; a Tower capture writes a `towerItem` beside
 * the pulse it records. Both are one commit, deliberately — routing either
 * through `createTowerItem`/`toggleCompletion` would be a second commit, the
 * exact split the one-commit rule exists to prevent — and both therefore go
 * straight past the provider that renders the row.
 *
 * `AppContext`'s reducer state is read once on open and refreshed only by a
 * pull that fetched something; a push never refreshes it. Without this the
 * owner taps "+ call the plumber", or types into Tower's own box, and the item
 * is not there until the app is reloaded: a durable write that reads exactly
 * like a failed one.
 *
 * A listener only re-reads what is already on the device. The write it is
 * told about has already landed; nothing here writes anything, and this is
 * deliberately not a second write path.
 *
 * Same shape as `github.ts`'s `onPushFailure`: a module-level set, no React,
 * nothing to clean up, and a listener that throws cannot disturb the write it
 * is watching.
 */
const localWriteListeners = new Set<() => void>();

/** Watch every write this layer made outside the pulse. Returns the unsubscribe. */
export function onLocalWrite(listener: () => void): () => void {
  localWriteListeners.add(listener);
  return () => {
    localWriteListeners.delete(listener);
  };
}

function reportLocalWrite(): void {
  for (const listener of localWriteListeners) {
    try {
      listener();
    } catch {
      // A watcher's problem is not the write's problem.
    }
  }
}

/**
 * Per-effect auto-apply, one device-local `meta` key each (Appendix C: all
 * default off). `vocabProposal` is absent by design and must stay absent.
 */
const AUTO_APPLY_META_KEY: Record<PulseEffectType, MetaKey> = {
  completeHabit: 'autoApplyCompleteHabit',
  spawnTask: 'autoApplySpawnTask',
  updateTask: 'autoApplyUpdateTask',
  claimEvent: 'autoApplyClaimEvent',
};

/** Whether this device applies `type` by itself. Off until the owner says so. */
export async function getPulseEffectAutoApply(type: PulseEffectType): Promise<boolean> {
  return (await getMeta<boolean>(AUTO_APPLY_META_KEY[type], false)) === true;
}

/** Turn one effect type's auto-apply on or off, on this device only. */
export async function setPulseEffectAutoApply(type: PulseEffectType, on: boolean): Promise<void> {
  await setMeta(AUTO_APPLY_META_KEY[type], on);
}

/** The pulse-side half of an apply: the effect leaves the list, and stays gone. */
function withoutEffect(row: PulseRow, index: number): Record<string, unknown> {
  return { effects: (row.effects ?? []).filter((_, at) => at !== index) };
}

/**
 * The `habitCompletion` draft a `completeHabit` chip stands for, or none.
 *
 * The date is the pulse's OWN local day, not today's: the coder already reads
 * a pulse against its own instant (see `CoderContext.now`), and a sweep
 * draining a backlog on Saturday must not tick Saturday's box for a Thursday
 * line. The entity id is the natural key `habit+date` through
 * `resolveEntityId`, which is what makes an apply idempotent — a repeat is
 * the same row, never a second completion.
 *
 * The habit is resolved by id against the live habits, the same ones the
 * coder was shown. An id naming none of them writes nothing.
 */
function completeHabitDraft(row: PulseRow, effect: PulseEffect, habits: readonly Habit[]): EventDraft | null {
  const habitId = effectString(effect, 'habitId');
  if (habitId === null || !habits.some((habit) => habit.id === habitId)) return null;

  const at = Date.parse(row.at);
  if (!Number.isFinite(at)) return null;

  const key = habitCompletionKey(habitId, dayKey(at, deviceTimeZone()));
  const completions = readHabitCompletions();
  const entityId = resolveEntityId(completions, completionKeyOf, key);
  const fields: Record<string, unknown> = { habit_id: habitId, date: dayKey(at, deviceTimeZone()) };
  if (!completions.some((completion) => completion.id === entityId)) fields.created_at = nowIso();

  return { entity: ENTITY.habitCompletion, entityId, type: 'upsert', fields };
}

/**
 * The `towerItem` draft an `updateTask` chip stands for, or none.
 *
 * The item is resolved by id and must already exist: an upsert against an id
 * nothing holds would not update a task, it would RESURRECT a deleted one as
 * a textless ghost carrying only the fields written here. `status` is checked
 * against the four Tower knows for the same reason.
 */
function updateTaskDraft(effect: PulseEffect): EventDraft | null {
  const towerId = effectString(effect, 'towerId');
  if (towerId === null || !readTowerItemRows().some((item) => item.id === towerId)) return null;

  const fields: Record<string, unknown> = {};
  const status = effectString(effect, 'status');
  if (status !== null && (TOWER_STATUSES as readonly string[]).includes(status)) fields.status = status;
  const waitingOn = effectString(effect, 'waitingOn');
  if (waitingOn !== null) fields.waiting_on = waitingOn;
  const expectsBy = effectString(effect, 'expectsBy');
  if (expectsBy !== null) fields.expects_by = expectsBy;
  if (Object.keys(fields).length === 0) return null;

  // Any touch counts as attention, exactly as `updateTowerItem` records it.
  fields.last_touched = nowIso();
  // And `done` carries its date, exactly as `completeTowerItem` writes it. A
  // done row with no `done_at` is one Tower can never say when it finished,
  // and in a journal that is never compacted it stays that way forever.
  if (fields.status === 'done') fields.done_at = fields.last_touched;
  return { entity: ENTITY.towerItem, entityId: towerId, type: 'upsert', fields };
}

/**
 * Apply one proposed effect: the chip's own write and the chip's removal, in
 * one commit (see this section's opening note).
 *
 * BY VALUE, never by position. A chip is identified by exactly what it
 * proposes (`effectKey`), because an apply removes an effect and shifts every
 * later one down: a caller holding a position taken before that — a second tap
 * on a chip the repaint has not yet cleared, or a repaint that never came
 * because the re-read threw — would name a DIFFERENT proposal, and apply one
 * the owner never tapped. That is worse than applying none at all, and it is
 * silent. A position cannot survive the queue below either.
 *
 * The effect always leaves the list, whether or not it could be applied. An
 * effect naming a habit that no longer exists, or a task that was deleted, is
 * not a failure to report — there is nothing to do and nothing that will ever
 * make there be, so the honest outcome is the chip going away. That also
 * keeps the auto-apply pass below finite.
 *
 * An effect the pulse no longer holds, or a pulse that is gone: nothing at all
 * is written.
 */
export async function applyPulseEffect(pulseId: string, effect: PulseEffect): Promise<void> {
  return serializePulseWrite(() => applyOneEffect(pulseId, effect));
}

async function applyOneEffect(pulseId: string, target: PulseEffect): Promise<void> {
  // One await, then every read is against a settled session: `commit`'s own
  // generation guard covers the write, but a row read either side of a
  // suspension point would not be reading the same state. The row is read
  // again HERE, inside the queue, because the apply ahead of this one has
  // already changed it.
  const habits = await getHabits();

  const row = readPulseRows().find((candidate) => candidate.id === pulseId);
  if (row === undefined) return;
  const effects = row.effects ?? [];
  const wanted = effectKey(target);
  const index = effects.findIndex((candidate) => effectKey(candidate) === wanted);
  // Gone already — applied or dismissed while this waited its turn.
  if (index === -1) return;
  const effect = effects[index];

  const pulseFields = withoutEffect(row, index);
  const drafts: EventDraft[] = [];

  switch (effect.type) {
    case 'completeHabit': {
      const draft = completeHabitDraft(row, effect, habits);
      if (draft !== null) drafts.push(draft);
      break;
    }
    case 'spawnTask': {
      // Already spawned. The item exists, this tap is a repeat, and minting a
      // second id is the one mistake in this file that cannot be undone by
      // tapping again — so the chip goes and nothing is created.
      if ((row.links ?? NO_LINKS).towerId !== null) break;
      const text = spawnTaskText(row, effect);
      if (text.length === 0) break;
      const towerId = newId();
      const now = nowIso();
      drafts.push({
        entity: ENTITY.towerItem,
        entityId: towerId,
        type: 'upsert',
        // The same fields `createTowerItem` writes, mirrored rather than
        // called: that function is its own commit, and this must be one.
        fields: {
          text,
          status: 'active',
          waiting_on: null,
          expects_by: null,
          effort: null,
          is_event: false,
          last_touched: now,
          created_at: now,
          done_at: null,
        },
      });
      pulseFields.links = { ...(row.links ?? NO_LINKS), towerId };
      break;
    }
    case 'updateTask': {
      const draft = updateTaskDraft(effect);
      if (draft !== null) drafts.push(draft);
      break;
    }
    case 'claimEvent': {
      // The whole effect IS a field on the pulse: a claim is derived from the
      // stream, with no entity of its own (Appendix C). The event id is not
      // checked against the calendar mirror — the mirror is a read-only cache
      // that can be stale or absent, and a claim must not depend on it.
      const eventId = effectString(effect, 'eventId');
      if (eventId !== null) pulseFields.links = { ...(row.links ?? NO_LINKS), eventId };
      break;
    }
  }

  drafts.push({ entity: ENTITY.pulse, entityId: pulseId, type: 'upsert', fields: pulseFields });
  await commit(drafts);

  // Anything beyond the pulse's own upsert is a row Tower or Habits shows,
  // and neither of those reads this store directly. Told after the commit,
  // never before: what is on screen must not claim a write that has not
  // landed. See `onLocalWrite`.
  if (drafts.length > 1) reportLocalWrite();
}

/**
 * Drop one proposed effect and keep the coding (Appendix C). The rest of the
 * enrichment is untouched, so a dismissed chip changes what is offered, never
 * what the pulse was read as.
 *
 * Carried by value and queued for exactly the reasons `applyPulseEffect`
 * gives: it rewrites the same whole list, so a dismiss racing an apply
 * overwrites it, and a position taken before the queue names the wrong chip
 * after it.
 */
export async function dismissPulseEffect(pulseId: string, effect: PulseEffect): Promise<void> {
  return serializePulseWrite(async () => {
    // Inside the queue: a pull landing while this waited its turn drops the
    // session, and the read below would otherwise be against nothing.
    await hydrate();
    const row = readPulseRows().find((candidate) => candidate.id === pulseId);
    if (row === undefined) return;
    const wanted = effectKey(effect);
    const at = (row.effects ?? []).findIndex((candidate) => effectKey(candidate) === wanted);
    if (at === -1) return;
    await commit([{ entity: ENTITY.pulse, entityId: pulseId, type: 'upsert', fields: withoutEffect(row, at) }]);
  });
}

/**
 * The `pulseVocab` fields an approved proposal would write, or none.
 *
 * Additive and set-like: a value already there writes nothing, so approving
 * the same proposal twice cannot duplicate it. An `activity` with no domain
 * to map to, or a `habitAlias` pointing at no live habit, is not written —
 * Appendix A's shapes are `label -> domain` and `alias -> habitId`, and half
 * an entry is worse than none for phase 3, which reads nothing else.
 */
function vocabFieldsFor(
  vocab: PulseVocabRow,
  proposal: PulseVocabProposal,
  habits: readonly Habit[]
): Record<string, unknown> | null {
  switch (proposal.kind) {
    case 'domain':
      if (vocab.domains.includes(proposal.value)) return null;
      return { domains: [...vocab.domains, proposal.value] };
    case 'activity':
      if (proposal.mapsTo === null) return null;
      if (vocab.activities[proposal.value] === proposal.mapsTo) return null;
      return { activities: { ...vocab.activities, [proposal.value]: proposal.mapsTo } };
    case 'person':
      if (vocab.people.includes(proposal.value)) return null;
      return { people: [...vocab.people, proposal.value] };
    case 'habitAlias': {
      const habitId = proposal.mapsTo;
      if (habitId === null || !habits.some((habit) => habit.id === habitId)) return null;
      if (vocab.habitAliases[proposal.value] === habitId) return null;
      return { habitAliases: { ...vocab.habitAliases, [proposal.value]: habitId } };
    }
  }
}

/**
 * Approve the vocabulary proposal on a pulse: the `pulseVocab` upsert and the
 * proposal's removal, in one commit.
 *
 * Confirm-only, forever. Appendix C gives this no auto-apply toggle and this
 * function is reachable from nothing but a tap — the vocabulary is the spine
 * the coder reads on every call, so it grows by the owner's hand or not at
 * all.
 *
 * Seeding runs first and is deliberately NOT part of the pair: it is its own
 * idempotent write (`ensurePulseVocabSeeded`), and the row has to exist
 * before it can grow.
 */
export async function approvePulseVocabProposal(pulseId: string): Promise<void> {
  const [vocab, habits] = await Promise.all([ensurePulseVocabSeeded(), getHabits()]);

  const row = readPulseRows().find((candidate) => candidate.id === pulseId);
  const proposal = row?.vocabProposal;
  if (row === undefined || proposal === undefined || proposal === null) return;

  const fields = vocabFieldsFor(vocab, proposal, habits);
  const drafts: EventDraft[] = [];
  if (fields !== null) drafts.push({ entity: ENTITY.pulseVocab, entityId: PULSE_VOCAB_ID, type: 'upsert', fields });
  // `null` is a real stored value meaning "cleared", which is what keeps the
  // chip from coming back when the row is folded again on another device.
  drafts.push({ entity: ENTITY.pulse, entityId: pulseId, type: 'upsert', fields: { vocabProposal: null } });

  await commit(drafts);
}

/** Drop the vocabulary proposal and keep the coding. */
export async function dismissPulseVocabProposal(pulseId: string): Promise<void> {
  await hydrate();
  const row = readPulseRows().find((candidate) => candidate.id === pulseId);
  if (row === undefined || row.vocabProposal === undefined || row.vocabProposal === null) return;
  await commit([{ entity: ENTITY.pulse, entityId: pulseId, type: 'upsert', fields: { vocabProposal: null } }]);
}

/**
 * Apply, without a tap, the effects whose type this device has switched on.
 *
 * Called from ONE place — `codeRow`, the moment a coding lands — and never
 * over stored effects. That is the whole guarantee behind the toggles: they
 * change what happens next, not what already happened. An owner who turns
 * `spawnTask` on after a fortnight of coded pulses gets no burst of Tower
 * items for proposals that have been sitting there; a sweep over the store
 * would give exactly that, and there is deliberately no code path that could.
 *
 * The list is re-read each time round because every apply rewrites it, and the
 * effect found in it is carried by value, as every other caller carries one.
 * The loop is bounded by the effects the coding produced, and terminates
 * because an apply always removes its effect, applicable or not.
 *
 * Never throws: an auto-apply that fails leaves the chip exactly where a
 * manual one would have — on screen, still tappable.
 */
async function autoApplyEffects(pulseId: string): Promise<void> {
  try {
    const enabled = new Set<PulseEffectType>();
    for (const type of PULSE_EFFECT_TYPES) {
      if (await getPulseEffectAutoApply(type)) enabled.add(type);
    }
    if (enabled.size === 0) return;

    const initial = readPulseRows().find((row) => row.id === pulseId)?.effects?.length ?? 0;
    for (let remaining = initial; remaining > 0; remaining -= 1) {
      const effects = readPulseRows().find((row) => row.id === pulseId)?.effects ?? [];
      const effect = effects.find((candidate) => enabled.has(candidate.type));
      if (effect === undefined) return;
      await applyPulseEffect(pulseId, effect);
    }
  } catch {
    // Same shape as every other failure on this path: nothing happened.
  }
}

// ============================================================================
// Pulse coding (lazy queue)
// ============================================================================

/**
 * Ids being coded this session. Memory only, never persisted: if the tab
 * dies mid-call nothing survives that could wedge a pulse as permanently
 * in-flight, or make it look coded — a crash must read exactly like "not
 * started" (L3). This guards only against this session calling the coder
 * twice at once for the same id (the on-save and on-open triggers landing
 * together); it is not a lock and needs to be nothing more.
 */
const codingInFlight = new Set<string>();

/**
 * The last five pulses strictly before `row`, oldest first, each carrying its
 * own coding when it already has one. Scoped to exactly the allowlist's
 * `recentPulses` shape (fence 5) — never the full row, never `text`/`at`
 * beyond what a pulse already exposes.
 */
function recentPulsesFor(row: PulseRow, allRows: readonly PulseRow[]): RecentPulse[] {
  return allRows
    .filter((other) => other.id !== row.id && other.at < row.at)
    .sort(compareOldestFirst)
    .slice(-5)
    .map((other) => ({
      text: other.text,
      coding:
        other.signal === undefined
          ? undefined
          : ({
              signal: other.signal,
              domain: other.domain ?? null,
              activity: other.activity ?? null,
              people: other.people ?? [],
              span: other.span ?? { start: other.at, end: null, approx: false },
              links: other.links ?? { habitId: null, towerId: null, eventId: null },
            } satisfies PulseEnrichment),
    }));
}

/**
 * Assembles exactly the slices Appendix B's allowlist names, and nothing else
 * (fence 5).
 *
 * `mouth` comes off the row rather than off the caller: the queue is lazy, so
 * the sweep coding a backlog has no idea which box any of it was typed into,
 * and by then the box is long closed. A pulse with no `mouth` is a Pulse-page
 * one — the unbiased mouth, and every pulse written before Tower had one.
 */
async function buildCoderContext(row: PulseRow, allRows: readonly PulseRow[]): Promise<CoderContext> {
  const tz = deviceTimeZone();
  // The pulse's own local day, not the sweep's. The queue is lazy by design,
  // so this runs hours or days after capture; a Thursday utterance shown
  // Saturday's calendar and Saturday's habit ticks would be coded against a
  // day it has nothing to do with. See `CoderContext.now` for the reading of
  // Appendix B that this follows.
  const day = dayKey(Date.parse(row.at), tz);

  const [vocab, habits, completions, towerItems, mirror] = await Promise.all([
    ensurePulseVocabSeeded(),
    getHabits(),
    getCompletionsForDate(day),
    getTowerItems(false),
    loadCalendar(),
  ]);

  return {
    now: row.at,
    tz,
    vocab: {
      domains: vocab.domains,
      activities: vocab.activities,
      people: vocab.people,
      habitAliases: vocab.habitAliases,
    },
    todayEvents: eventsForDay(mirror, day, tz).map((event) => ({
      id: event.id,
      title: event.title,
      calendar: event.calendar,
      start: event.start,
      end: event.end,
    })),
    todayHabits: habits.map((habit) => ({
      id: habit.id,
      name: habit.label,
      done: completions[habit.id] ?? false,
    })),
    openTowerItems: towerItems.map((item) => ({ id: item.id, text: item.text, status: item.status })),
    recentPulses: recentPulsesFor(row, allRows),
    mouth: row.mouth ?? 'today',
  };
}

/**
 * How many pulses one sweep will code.
 *
 * A month away leaves hundreds uncoded, and every one is a paid call; a cap
 * turns "the app is opened after a long silence" from an unbounded bill into
 * about a dime. Twenty covers a talkative day (the plan's own 30-pulses/day
 * estimate) in two opens, and the owner is told nothing about it either way —
 * uncoded is calm (fence 2), and the rest get coded on the next open.
 */
export const MAX_PULSES_PER_SWEEP = 20;

/**
 * Whether the STORE — not a snapshot — now holds a coding for this pulse.
 *
 * `signal === undefined` is the one, total test for "uncoded" (`PulseRow`), so
 * this is that same test, read fresh. Both callers awaited `getPulses()`, so
 * the session is hydrated and this needs no await of its own — which is what
 * lets it sit between the in-flight guard and the calls it protects.
 *
 * A pulse that is GONE reads as not coded, deliberately. An enrichment landing
 * after a delete resurrects it, which is pinned behaviour (P2); this is a
 * re-entry guard, not a resurrection guard, and must not quietly become one.
 */
function alreadyCoded(id: string): boolean {
  return readPulseRows().find((row) => row.id === id)?.signal !== undefined;
}

/**
 * Code one pulse, if it is not already being coded.
 *
 * Never throws. A failure at any step — the coder, the write — leaves the
 * pulse exactly as it was: uncoded, `text` and `at` untouched (L1, L2). The
 * `has`/`add` pair is the whole in-flight guard, and it is deliberately
 * synchronous: nothing may await between the two, or the on-save and on-open
 * triggers can both slip past it for the same pulse and bill it twice.
 *
 * That pair only excludes an OVERLAP. The row itself is re-read twice, for
 * the coding that already FINISHED: both callers hand in a row off a snapshot
 * taken before they started, and a sweep blocked on an earlier pulse resumes
 * into a list where the pulse it is about to code was coded, and its effects
 * applied, while it waited. Coding it again bills a second call, writes a
 * second set of proposals, and — with `spawnTask` auto-apply on — measured two
 * pulses in, three Tower items out. The second read is not a duplicate of the
 * first: `buildCoderContext` awaits the vocab seed and the calendar between
 * them, which is a second window of exactly the same shape.
 */
async function codeRow(row: PulseRow, allRows: readonly PulseRow[]): Promise<void> {
  if (codingInFlight.has(row.id)) return;
  codingInFlight.add(row.id);
  try {
    if (alreadyCoded(row.id)) return;
    const context = await buildCoderContext(row, allRows);
    if (alreadyCoded(row.id)) return;
    const coding = await codePulse(row.text, context);
    // A null coding is not a failure to recover from — it is fence 2's
    // correct, finished outcome, and the pulse simply stays uncoded.
    if (coding) {
      await enrichPulse(row.id, coding);
      // The one place auto-apply is ever reached from: a coding, the moment it
      // lands. Never a sweep over stored effects — see `autoApplyEffects`.
      await autoApplyEffects(row.id);
      // The enrichment is durable in the outbox either way; this only shortens
      // the window in which it is invisible to the other device, which would
      // otherwise re-code the same pulse and bill it a second time.
      scheduleFlush();
    }
  } catch {
    // Network, parse, anything at all: nothing here reacts to it.
  } finally {
    codingInFlight.delete(row.id);
  }
}

/**
 * Code the pulse just captured, and only it.
 *
 * "Coding runs on-save when online" — on-save means this one line, not a
 * re-walk of the whole history on every Enter. The backlog belongs to the
 * sweep, which runs on open.
 */
export async function codeCapturedPulse(id: string): Promise<void> {
  const rows = await getPulses();
  const row = rows.find((candidate) => candidate.id === id);
  if (!row || row.signal !== undefined) return;
  if (!Number.isFinite(Date.parse(row.at))) return;
  await codeRow(row, rows);
}

/**
 * Code whatever is currently uncoded, up to `MAX_PULSES_PER_SWEEP`.
 *
 * "Uncoded" is derived — `signal === undefined` — never a stored flag (see
 * `PulseRow`'s own doc comment): a pulse already coded is invisible to this
 * loop by construction, which is what keeps a re-open from re-coding it, and
 * re-billing it, on every open (P1).
 *
 * Sequential, not fanned out: a backlog of uncoded pulses should not become a
 * burst of concurrent Anthropic calls.
 *
 * `signal` ends the sweep when the page it was opened for is gone. It is
 * checked between pulses and never handed to `fetch`: a call already in flight
 * has already been paid for, so it is allowed to finish and store its answer.
 *
 * A pulse whose `at` is not a readable instant is skipped, not coded. It
 * belongs to no day — `pulsesForDay` already drops it from the stream for the
 * same reason — and there is no instant to resolve "at 6" against. Nothing in
 * the app writes such a row; a hand-edited journal can.
 *
 * Never throws.
 */
export async function codeUncodedPulses(signal?: AbortSignal): Promise<void> {
  const rows = await getPulses();
  let attempts = 0;
  for (const row of rows) {
    if (signal?.aborted) return;
    if (row.signal !== undefined) continue;
    if (codingInFlight.has(row.id)) continue;
    if (!Number.isFinite(Date.parse(row.at))) continue;
    if (attempts >= MAX_PULSES_PER_SWEEP) return;

    attempts += 1;
    await codeRow(row, rows);
  }
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
 * Tower's own box: one submission, one item AND one pulse, in one commit.
 *
 * "One parser, two mouths." Tower's input keeps exactly the behaviour the
 * owner likes — an item appears immediately, from the raw text, with nothing
 * between Enter and a saved task — and the same submission is also recorded in
 * the stream, where the coder reaches it. Nothing about the item waits on the
 * coder; the coding arrives later and proposes, as a chip on the item.
 *
 * ONE commit, for the reason the chip layer has one (see "Pulse proposals"):
 * split in two, a failure between them either costs the owner the item they
 * watched appear, or leaves an orphan pulse claiming a task that does not
 * exist — and the pulse is the only record of the utterance. `commit` turns
 * the array into one `enqueue`, so both land or neither does. `createTowerItem`
 * is mirrored rather than called for exactly that reason: it is its own commit.
 *
 * `links.towerId` is the recorded fact that this line IS that item. It also
 * arms `spawnTask`'s existing guard, so a coding that proposes a task anyway —
 * the tower mouth biases toward `task` — cannot mint a second one.
 *
 * No read-back of either row. `createPulse`'s read-and-throw is a live hazard
 * rather than a check (a pull landing mid-call leaves the event enqueued but
 * not applied to this session, L4); the ids are what the caller needs, and
 * they are known before the write.
 */
export async function captureTowerItem(text: string): Promise<{ towerId: string; pulseId: string }> {
  await hydrate();

  const line = text.trim();
  const towerId = newId();
  const pulseId = newId();
  const now = nowIso();

  await commit([
    {
      entity: ENTITY.towerItem,
      entityId: towerId,
      type: 'upsert',
      // The fields `createTowerItem` writes for an input of `{ text }`.
      fields: {
        text: line,
        status: 'active',
        waiting_on: null,
        expects_by: null,
        effort: null,
        is_event: false,
        last_touched: now,
        created_at: now,
        done_at: null,
      },
    },
    {
      entity: ENTITY.pulse,
      entityId: pulseId,
      type: 'upsert',
      fields: { text: line, at: now, mouth: 'tower', links: { habitId: null, towerId, eventId: null } },
    },
  ]);

  // The item is `AppContext`'s to render and this never went through it.
  reportLocalWrite();

  return { towerId, pulseId };
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
