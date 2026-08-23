/**
 * Domain entities — the seam between the journal and the app's data API.
 *
 * Owns three things and nothing else:
 *  1. the entity names and row shapes the app's nine ported tables became,
 *  2. the mapping from a folded record back to a row (and to the domain
 *     objects the views expect),
 *  3. the session store: an in-memory event array, the state folded from it,
 *     and the commit path that turns a change into journal events.
 *
 * No owner concept exists locally, so no row carries `user_id`.
 *
 * `fold()` only returns a bucket for an entity that has at least one surviving
 * record, so on a fresh device the state is `{}`. Every read here goes through
 * `bucket()`, which is the one place that guard lives.
 */

import { allCachedFiles, enqueue, getDeviceId, nextSeq, peekOutbox, setMeta, setState } from './db';
import type { OutboxRecord } from './db';
import { fold, parseJournalLines } from './journal';
import type { FoldedState, JournalEvent } from './journal';
import type {
  HabitCategory,
  MitCategory,
  Pack,
  PackSession,
  TowerEffort,
  TowerItem,
  TowerStatus,
} from '../types';

// ============================================================================
// Entity names
// ============================================================================

/** The nine entities the ported tables became. Journal `entity` values. */
export const ENTITY = {
  profile: 'profile',
  habit: 'habit',
  dailyEntry: 'dailyEntry',
  habitCompletion: 'habitCompletion',
  task: 'task',
  yearTheme: 'yearTheme',
  towerItem: 'towerItem',
  pack: 'pack',
  packSession: 'packSession',
} as const;

// ============================================================================
// Row types — the Postgres rows minus `user_id`
// ============================================================================

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  created_at: string;
  /**
   * When this row was last written. The profile is a singleton whose duplicate
   * is resolved by merging, and the merge needs to know which row is newer;
   * `created_at` cannot say, because the row created most recently is the one
   * holding the oldest edits.
   */
  updated_at: string | null;
  week_starts_on: number;
  theme: string | null;
  personal_context: string | null;
  ai_tone: 'stoic' | 'friendly' | 'wise';
  claude_api_key: string | null;
};

export type Habit = {
  id: string;
  label: string;
  description: string | null;
  category: HabitCategory;
  emoji: string | null;
  sort_order: number;
  created_at: string;
  archived_at: string | null;
};

export type DailyEntry = {
  id: string;
  date: string;
  focus: string | null;
  reflection: string | null;
  is_holiday: boolean;
  created_at: string;
  updated_at: string;
};

export type HabitCompletion = {
  id: string;
  habit_id: string;
  date: string;
  created_at: string;
};

export type Task = {
  id: string;
  date: string;
  category: MitCategory;
  text: string;
  completed: boolean;
  first_step: string | null;
  sort_order: number;
  created_at: string;
  completed_at: string | null;
};

export type YearTheme = {
  id: string;
  year: number;
  theme: string;
};

export type TowerItemRow = {
  id: string;
  text: string;
  status: TowerStatus;
  waiting_on: string | null;
  expects_by: string | null;
  effort: TowerEffort | null;
  is_event: boolean;
  /** Nullable in the DDL. Null is not the epoch: it sorts last, not first. */
  last_touched: string | null;
  /** Nullable in the DDL. Null is not the epoch: it sorts last, not first. */
  created_at: string | null;
  done_at: string | null;
};

export type PackRow = {
  id: string;
  label: string;
  total: number;
  /** Nullable in the DDL. Null is not the epoch: newest-first puts it first. */
  created_at: string | null;
  archived_at: string | null;
};

export type PackSessionRow = {
  id: string;
  pack_id: string;
  date: string;
  note: string | null;
  created_at: string;
};

// ============================================================================
// Field readers
// ============================================================================

/** A record's fields are whatever the journal said they were: check each one. */
type Record_ = Record<string, unknown>;

const HABIT_CATEGORIES: readonly HabitCategory[] = ['health', 'work', 'family', 'learning', 'other'];
const MIT_CATEGORIES: readonly MitCategory[] = ['work', 'self', 'family'];
const TOWER_STATUSES: readonly TowerStatus[] = ['active', 'waiting', 'someday', 'done'];
const TOWER_EFFORTS: readonly TowerEffort[] = ['quick', 'medium', 'deep'];
const AI_TONES: readonly Profile['ai_tone'][] = ['stoic', 'friendly', 'wise'];

/** Stands in for a missing timestamp so a row never carries an empty string. */
const EPOCH_FLOOR = new Date(0).toISOString();

/** The profile's entity id before one has ever been written or seeded. */
const LOCAL_PROFILE_ID = 'profile';

function str(record: Record_, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(record: Record_, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

/**
 * A timestamp column the DDL allows to be null.
 *
 * An explicit null survives as null; only an absent field takes the fallback.
 * Collapsing the two would hand `1970-01-01` to the comparators, which sorts a
 * null row to the opposite end from the `NULLS LAST` / `NULLS FIRST` the
 * database put it at.
 */
function nullableTimestamp(record: Record_, key: string, fallback: string | null): string | null {
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'string' ? value : fallback;
}

function num(record: Record_, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(record: Record_, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** One of a closed set of schema values, or the column's default. */
function oneOf<T extends string>(record: Record_, key: string, options: readonly T[], fallback: T): T {
  const value = record[key];
  for (const option of options) {
    if (value === option) return option;
  }
  return fallback;
}

function nullableOneOf<T extends string>(record: Record_, key: string, options: readonly T[]): T | null {
  const value = record[key];
  for (const option of options) {
    if (value === option) return option;
  }
  return null;
}

// ============================================================================
// Record -> row
// ============================================================================

export function toProfile(id: string, record: Record_): Profile {
  return {
    id,
    username: nullableStr(record, 'username'),
    display_name: nullableStr(record, 'display_name'),
    created_at: str(record, 'created_at', EPOCH_FLOOR),
    updated_at: nullableTimestamp(record, 'updated_at', null),
    week_starts_on: num(record, 'week_starts_on', 1),
    theme: nullableStr(record, 'theme'),
    personal_context: nullableStr(record, 'personal_context'),
    ai_tone: oneOf(record, 'ai_tone', AI_TONES, 'stoic'),
    claude_api_key: nullableStr(record, 'claude_api_key'),
  };
}

function toHabit(id: string, record: Record_): Habit {
  return {
    id,
    label: str(record, 'label', ''),
    description: nullableStr(record, 'description'),
    category: oneOf(record, 'category', HABIT_CATEGORIES, 'other'),
    emoji: nullableStr(record, 'emoji'),
    sort_order: num(record, 'sort_order', 0),
    created_at: str(record, 'created_at', EPOCH_FLOOR),
    archived_at: nullableStr(record, 'archived_at'),
  };
}

function toDailyEntry(id: string, record: Record_): DailyEntry {
  const createdAt = str(record, 'created_at', EPOCH_FLOOR);
  return {
    id,
    date: str(record, 'date', ''),
    focus: nullableStr(record, 'focus'),
    reflection: nullableStr(record, 'reflection'),
    is_holiday: bool(record, 'is_holiday', false),
    created_at: createdAt,
    updated_at: str(record, 'updated_at', createdAt),
  };
}

function toHabitCompletion(id: string, record: Record_): HabitCompletion {
  return {
    id,
    habit_id: str(record, 'habit_id', ''),
    date: str(record, 'date', ''),
    created_at: str(record, 'created_at', EPOCH_FLOOR),
  };
}

function toTask(id: string, record: Record_): Task {
  return {
    id,
    date: str(record, 'date', ''),
    category: oneOf(record, 'category', MIT_CATEGORIES, 'work'),
    text: str(record, 'text', ''),
    completed: bool(record, 'completed', false),
    first_step: nullableStr(record, 'first_step'),
    sort_order: num(record, 'sort_order', 0),
    created_at: str(record, 'created_at', EPOCH_FLOOR),
    completed_at: nullableStr(record, 'completed_at'),
  };
}

function toYearTheme(id: string, record: Record_): YearTheme {
  return {
    id,
    year: num(record, 'year', 0),
    theme: str(record, 'theme', ''),
  };
}

function toTowerItemRow(id: string, record: Record_): TowerItemRow {
  const createdAt = nullableTimestamp(record, 'created_at', EPOCH_FLOOR);
  return {
    id,
    text: str(record, 'text', ''),
    status: oneOf(record, 'status', TOWER_STATUSES, 'active'),
    waiting_on: nullableStr(record, 'waiting_on'),
    expects_by: nullableStr(record, 'expects_by'),
    effort: nullableOneOf(record, 'effort', TOWER_EFFORTS),
    is_event: bool(record, 'is_event', false),
    last_touched: nullableTimestamp(record, 'last_touched', createdAt),
    created_at: createdAt,
    done_at: nullableStr(record, 'done_at'),
  };
}

function toPackRow(id: string, record: Record_): PackRow {
  return {
    id,
    label: str(record, 'label', ''),
    total: num(record, 'total', 0),
    created_at: nullableTimestamp(record, 'created_at', EPOCH_FLOOR),
    archived_at: nullableStr(record, 'archived_at'),
  };
}

function toPackSessionRow(id: string, record: Record_): PackSessionRow {
  return {
    id,
    pack_id: str(record, 'pack_id', ''),
    date: str(record, 'date', ''),
    note: nullableStr(record, 'note'),
    created_at: str(record, 'created_at', EPOCH_FLOOR),
  };
}

// ============================================================================
// Row -> domain model (what the views consume)
// ============================================================================

/*
 * The domain types the views consume promise a string for every timestamp, so
 * a null column stops here rather than at the sort. Ordering already ran over
 * the row, where the null still meant "no value".
 */

export function toTowerItem(row: TowerItemRow): TowerItem {
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    waitingOn: row.waiting_on ?? undefined,
    expectsBy: row.expects_by ?? undefined,
    effort: row.effort ?? undefined,
    isEvent: row.is_event,
    lastTouched: row.last_touched ?? EPOCH_FLOOR,
    createdAt: row.created_at ?? EPOCH_FLOOR,
    doneAt: row.done_at ?? undefined,
  };
}

export function toPack(row: PackRow): Pack {
  return {
    id: row.id,
    label: row.label,
    total: row.total,
    createdAt: row.created_at ?? EPOCH_FLOOR,
    archivedAt: row.archived_at ?? undefined,
  };
}

export function toPackSession(row: PackSessionRow): PackSession {
  return {
    id: row.id,
    packId: row.pack_id,
    date: row.date,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Natural keys
// ============================================================================

/*
 * Three tables were keyed in Postgres by a composite unique constraint rather
 * than by their surrogate id: daily_entries (date), habit_completions
 * (habit_id, date) and year_themes (year). Locally the journal has no unique
 * constraints, so the entity id IS the composite key — two devices editing the
 * same day offline then write the same entity and converge, instead of
 * producing two rows for one date.
 *
 * A row seeded from the export carries its old surrogate id, so a write first
 * looks for an existing row with the same natural key and adopts its id;
 * `resolveEntityId` is that rule and the derived id is only the fallback.
 */

export function dailyEntryKey(date: string): string {
  return date;
}

export function habitCompletionKey(habitId: string, date: string): string {
  return `${habitId}:${date}`;
}

export function yearThemeKey(year: number): string {
  return String(year);
}

/**
 * The entity id a write to `key` must target: the lowest id already holding
 * that natural key, or the key itself when nothing holds it yet.
 *
 * Lowest-id-wins rather than first-seen so every device picks the same row if
 * a duplicate ever exists.
 */
export function resolveEntityId<T extends { id: string }>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  key: string
): string {
  let found: string | null = null;
  for (const row of rows) {
    if (keyOf(row) !== key) continue;
    if (found === null || row.id < found) found = row.id;
  }
  return found ?? key;
}

/**
 * The columns a record's own last-write time can live in, best first. Every
 * table that can carry a duplicate has at most one of them.
 */
const SOURCE_TIMESTAMPS = ['updated_at', 'last_touched', 'created_at'] as const;

/** When the record was last written, as far as the record itself can say. */
function sourceTimestamp(record: Record_): string {
  for (const column of SOURCE_TIMESTAMPS) {
    const value = record[column];
    if (typeof value === 'string') return value;
  }
  return '';
}

/** One entity id and the record folded for it. */
export type Candidate = { id: string; record: Record_ };

/** Oldest first, and on a tie the lower id last so its values are the ones kept. */
function byAscendingAge(a: Candidate, b: Candidate): number {
  const left = sourceTimestamp(a.record);
  const right = sourceTimestamp(b.record);
  if (left !== right) return left < right ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * Several entity ids holding one natural key, folded into one record.
 *
 * Dropping the losers would strand their content: the records stay in the
 * journal forever and nothing can ever read them again, so a reflection typed
 * in a second tab simply disappears. Each field is taken from whichever record
 * was written last and HAS the field — a record only carries what something
 * actually wrote, so an untouched column falls through to the record that did
 * write it. Ties go to the lower id, and the surviving id is the lowest, which
 * is the one `resolveEntityId` writes to: reads and writes stay on one row and
 * every replica reaches the same answer without talking to any other.
 */
function mergeCandidates(group: readonly Candidate[]): Candidate {
  const record: Record_ = {};
  for (const candidate of group.slice().sort(byAscendingAge)) {
    for (const [field, value] of Object.entries(candidate.record)) {
      // fold() already drops an explicit undefined; a null is a real value and
      // does overwrite, because at this level it means the column was cleared.
      if (value !== undefined) record[field] = value;
    }
  }

  let lowest = group[0].id;
  for (const candidate of group) {
    if (candidate.id < lowest) lowest = candidate.id;
  }

  return { id: lowest, record };
}

/**
 * One record per natural key — the unique constraint Postgres used to enforce.
 *
 * Takes records rather than mapped rows on purpose. `toHabit` and its siblings
 * fill every column with a null or a schema default, which makes "nobody ever
 * wrote this" indistinguishable from "somebody wrote null" — and that is
 * precisely what the merge has to know.
 */
export function uniqueByKey(
  records: Readonly<Record<string, Record_>>,
  keyOf: (record: Record_) => string
): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const id of Object.keys(records)) {
    const candidate = { id, record: records[id] };
    const key = keyOf(candidate.record);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else group.push(candidate);
  }

  const unique: Candidate[] = [];
  for (const group of groups.values()) {
    unique.push(group.length === 1 ? group[0] : mergeCandidates(group));
  }
  return unique;
}

// ============================================================================
// Session store
// ============================================================================

/** A change to record, before it is given an id, a device, a seq and a ts. */
export type EventDraft =
  | { entity: string; entityId: string; type: 'upsert'; fields: Record<string, unknown> }
  | { entity: string; entityId: string; type: 'delete' };

let sessionEvents: JournalEvent[] = [];
let sessionState: FoldedState = {};
let hydration: Promise<void> | null = null;

/**
 * Bumped by every reset. Work that suspended before the reset is holding a
 * session that no longer exists, so on resuming it must throw its result away
 * rather than write it over the new one.
 */
let generation = 0;

/**
 * Everything that touches the session queues here.
 *
 * `commit` suspends four times before it is done (the device id, one seq per
 * draft, the outbox write, the state write) and `load` twice. Left to
 * interleave, a load assigns the whole array over events a commit just pushed,
 * and a commit persists a state a reset already replaced. Either way the
 * owner's edit is gone and nothing threw.
 */
let queue: Promise<void> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  // The queue itself must never reject: one failed write cannot be allowed to
  // fail every write queued behind it.
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Load the session's events from what is already on the device: every cached
 * journal file, plus the outbox for the edits that have not been pushed yet.
 * Idempotent — the first caller does the work and everyone awaits it.
 */
export function hydrate(): Promise<void> {
  if (hydration === null) {
    const attempt = serialize(load);
    // A transient failure — another tab blocking a version change, say — must
    // not be memoised: every one of this module's readers awaits `hydrate`, so
    // a kept rejection would fail every read for the rest of the session even
    // after the cause cleared. Guarded on identity so a reset that already
    // replaced the memo is not clobbered.
    attempt.catch(() => {
      if (hydration === attempt) hydration = null;
    });
    hydration = attempt;
  }
  return hydration;
}

async function load(): Promise<void> {
  const startedAt = generation;
  const events: JournalEvent[] = [];

  const files = await allCachedFiles();
  for (const file of files) {
    // Warnings are the journal's own business; a bad line is skipped, never
    // fatal, and surfacing it to the owner belongs to the app shell.
    events.push(...parseJournalLines(file.text, file.path).events);
  }

  // Anything still queued is already part of this device's history. fold()
  // dedupes by event id, so an event in both places is applied once.
  events.push(...(await peekOutbox<JournalEvent & OutboxRecord>()));

  // A reset while this was in flight dropped the session these events were
  // read for. Assigning them now would serve pre-reset data.
  if (startedAt !== generation) return;

  sessionEvents = events;
  refold();
}

/** Drops the session. Used by tests and by a full local reset. */
export function resetSession(): void {
  generation += 1;
  sessionEvents = [];
  sessionState = {};
  hydration = null;
}

/** The folded state of the session. */
export function currentState(): FoldedState {
  return sessionState;
}

/**
 * One entity's surviving records.
 *
 * The `?? {}` is the whole reason reads funnel through here: fold omits a
 * bucket entirely when nothing of that type survives, which on a fresh device
 * is every bucket.
 */
function bucket(entity: string): Record<string, Record<string, unknown>> {
  return sessionState[entity] ?? {};
}

function rowsOf<T>(entity: string, map: (id: string, record: Record_) => T): T[] {
  const records = bucket(entity);
  const rows: T[] = [];
  for (const id of Object.keys(records)) rows.push(map(id, records[id]));
  return rows;
}

export function readProfiles(): Profile[] {
  return rowsOf(ENTITY.profile, toProfile);
}

export function readHabits(): Habit[] {
  return rowsOf(ENTITY.habit, toHabit);
}

/** Raw rows: a duplicate natural key survives here and is resolved by the caller. */
export function readDailyEntries(): DailyEntry[] {
  return rowsOf(ENTITY.dailyEntry, toDailyEntry);
}

/** Raw rows: a duplicate natural key survives here and is resolved by the caller. */
export function readHabitCompletions(): HabitCompletion[] {
  return rowsOf(ENTITY.habitCompletion, toHabitCompletion);
}

/**
 * One row per natural key, duplicates merged. What every read wants; the two
 * writers that have to see each duplicate id separately take the raw rows.
 */
function mergedRowsOf<T>(
  entity: string,
  keyOf: (record: Record_) => string,
  map: (id: string, record: Record_) => T
): T[] {
  return uniqueByKey(bucket(entity), keyOf).map(({ id, record }) => map(id, record));
}

export function readMergedDailyEntries(): DailyEntry[] {
  return mergedRowsOf(
    ENTITY.dailyEntry,
    (record) => dailyEntryKey(str(record, 'date', '')),
    toDailyEntry
  );
}

export function readMergedHabitCompletions(): HabitCompletion[] {
  return mergedRowsOf(
    ENTITY.habitCompletion,
    (record) => habitCompletionKey(str(record, 'habit_id', ''), str(record, 'date', '')),
    toHabitCompletion
  );
}

export function readMergedYearThemes(): YearTheme[] {
  return mergedRowsOf(ENTITY.yearTheme, (record) => yearThemeKey(num(record, 'year', 0)), toYearTheme);
}

export function readTasks(): Task[] {
  return rowsOf(ENTITY.task, toTask);
}

/** Raw rows: a duplicate natural key survives here and is resolved by the caller. */
export function readYearThemes(): YearTheme[] {
  return rowsOf(ENTITY.yearTheme, toYearTheme);
}

export function readTowerItemRows(): TowerItemRow[] {
  return rowsOf(ENTITY.towerItem, toTowerItemRow);
}

export function readPackRows(): PackRow[] {
  return rowsOf(ENTITY.pack, toPackRow);
}

export function readPackSessionRows(): PackSessionRow[] {
  return rowsOf(ENTITY.packSession, toPackSessionRow);
}

/**
 * The one profile, with any duplicate merged in. Null only on a device that
 * has never written or synced one.
 *
 * The profile is a singleton, so every profile record is the same natural key.
 * Lowest-id-wins is the rule everywhere else and is exactly wrong here: the
 * sentinel a fresh device writes to sorts above every uuid, so a settings edit
 * made before the first sync could never win against the profile that sync
 * pulls down, and no natural key exists to adopt it back. Merging is the only
 * way that edit survives.
 */
export function readProfile(): Profile | null {
  const merged = mergedRowsOf(ENTITY.profile, () => LOCAL_PROFILE_ID, toProfile);
  return merged.length > 0 ? merged[0] : null;
}

/** The entity id a profile write must target. */
export function profileEntityId(): string {
  return readProfile()?.id ?? LOCAL_PROFILE_ID;
}

/** Every record folded from scratch. See `commit` for why it is never incremental. */
function refold(): void {
  sessionState = fold(sessionEvents).state;
}

/**
 * A fresh id for an event or a row.
 *
 * `crypto.randomUUID` is secure-context-only and is simply absent when the app
 * is opened over plain http on the LAN, so fall back to `getRandomValues`,
 * which is not gated on a secure context.
 */
export function newId(): string {
  const api: Crypto | undefined = globalThis.crypto;
  if (api && typeof api.randomUUID === 'function') return api.randomUUID();
  if (api && typeof api.getRandomValues === 'function') {
    const bytes = api.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('this browser exposes no crypto random source, so no id can be minted');
}

/**
 * Record a change: turn the drafts into journal events, queue them for the
 * next push, then rebuild state.
 *
 * The outbox is written BEFORE the in-memory array so a failed queue leaves
 * nothing behind: the caller sees the throw and the edit never appears. The
 * other order would show the owner a change that is in no journal and will
 * never be pushed.
 *
 * State is rebuilt by folding the whole array rather than by assigning the new
 * fields onto the old state. The fold's last-writer-wins guards live inside
 * fold; writing the fields directly would bypass them.
 */
export async function commit(drafts: readonly EventDraft[]): Promise<void> {
  if (drafts.length === 0) return;
  return serialize(() => record(drafts));
}

async function record(drafts: readonly EventDraft[]): Promise<void> {
  const startedAt = generation;

  const device = await getDeviceId();
  const ts = Date.now();
  const events: JournalEvent[] = [];
  for (const draft of drafts) {
    // One seq per event, taken in order: the counter is committed to disk
    // before it is handed out, so two events can never share one.
    const seq = await nextSeq();
    const core = { id: newId(), device, seq, ts, entity: draft.entity, entityId: draft.entityId };
    events.push(
      draft.type === 'upsert'
        ? { ...core, type: 'upsert', fields: draft.fields }
        : { ...core, type: 'delete' }
    );
  }

  // Nothing is durable until this line, so anything that failed above is a
  // write that did not happen and the caller has to hear about it.
  await enqueue(events);

  // Past this line the write HAS happened. A reset dropped the session these
  // events belonged to, but they are in the outbox and the next hydrate reads
  // them straight back.
  if (startedAt !== generation) return;

  sessionEvents.push(...events);
  refold();

  // The cached state is a read-path shortcut, not the record. Failing to
  // rewrite it — quota, a dead connection — must not reject: the caller reverts
  // what it optimistically applied, so the owner watches a toggle flip back and
  // then finds it applied after a reload. Note it and carry on.
  try {
    await setState(sessionState);
  } catch (error) {
    await noteStateFailure(error);
  }
}

async function noteStateFailure(error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  try {
    await setMeta('lastBackupError', `the cached state could not be saved: ${detail}`);
  } catch {
    // The note lives in the same database that just refused the state. There
    // is nowhere left to record it, and the write itself is still safe.
  }
}
