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

import { queued } from './async';
import { dayKey } from './calendar';
import { allCachedFiles, enqueue, getDeviceId, nextSeq, peekOutbox, setMeta, setState } from './db';
import type { OutboxRecord } from './db';
import { fold, parseJournalLines } from './journal';
import type { FoldedState, JournalEvent } from './journal';
import { randomToken } from './random';
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

/**
 * Nine entities the ported tables became, plus three the app grew on its own
 * (readItem, pulse, pulseVocab) — twelve, and no export behind the last three.
 *
 * `readItem` never existed in Postgres. It is the reading pane's record of
 * what has been read, and it is the first entity with no export behind it.
 * `pulse` is the second: one captured utterance, timestamped.
 * Journal `entity` values.
 *
 * Adding one is safe to deploy to a single device at a time. An older build
 * folding a `readItem` event does NOT skip it: `fold` validates an event's
 * shape and never its entity name, so the record lands in a bucket that build
 * has no reader for and is simply never looked at — no warning, no loss, and
 * the event is still there when that device updates. Pinned in
 * journal.test.ts, criterion 18, because it is a property of fold rather than
 * a promise made here.
 */
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
  readItem: 'readItem',
  pulse: 'pulse',
  pulseVocab: 'pulseVocab',
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
  /**
   * When the reading pane first synced on any device — the mark that says
   * everything published before it was already read elsewhere. Null until a
   * device that has seen the journal opens the pane.
   *
   * Snake_case like every other column here, rather than the plan's
   * `readingBaselineAt`: this row is a ported Postgres row and one camelCase
   * field would be the only one.
   */
  reading_baseline_at: string | null;
  /**
   * The daily calorie target the Today line reads against, or null for off
   * (phase 5). Snake_case for the same reason `reading_baseline_at` is: this
   * row is a ported Postgres row, and one camelCase field would be the only
   * one.
   *
   * A target is a number the owner set, never one the app inferred, and
   * nothing anywhere compares against it or says anything about the gap —
   * it is printed beside the total and that is all (fence 6).
   */
  kcal_target: number | null;
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

/**
 * One item of the reading corpus, marked read.
 *
 * The id IS the natural key — `<surface>:<itemKey>` — so two devices marking
 * the same essay write one entity and converge. Unmarking deletes it; a later
 * mark resurrects it, which is the fold's contract already.
 *
 * `read_at` is the only field written. Appendix D also names `starred` and
 * `note`; nothing offers either yet, and the journal takes a new field the day
 * something does, with no migration.
 */
export type ReadItemRow = {
  id: string;
  read_at: string;
};

/**
 * The coder's classification of an utterance — Appendix B's `signal` values.
 * `state`/`note`/`plan` never close a block or carry duration into the ledger.
 */
export type PulseSignal = 'block' | 'event' | 'state' | 'plan' | 'task' | 'claim' | 'note';

/** When the coder placed the utterance. `end`/`approx` per Appendix D's closure rules. */
export type PulseSpan = { start: string; end: string | null; approx: boolean };

/**
 * What a pulse's coding wired to elsewhere in the app. Set by enrichment or a chip apply.
 *
 * `habitId` and `towerId` left in phase 4 (fence 9): the coder no longer sees
 * habits or tower items, so it has no id to answer with. Historical journal
 * events still carry both keys — they are read past and ignored, never migrated.
 */
export type PulseLinks = { eventId: string | null };

/**
 * Appendix C's one surviving side effect. It is a proposal; nothing here applies itself.
 *
 * `completeHabit`, `spawnTask` and `updateTask` were retired in phase 4: habits
 * and Tower are manual spaces, and the coder is not an actuator.
 */
export type PulseEffectType = 'claimEvent';

/** One proposed side effect. Shape beyond `type` is proposal-specific and stays untyped. */
export type PulseEffect = { type: PulseEffectType } & Record<string, unknown>;

export type PulseVocabProposalKind = 'domain' | 'activity' | 'person';

/** A proposed addition to `pulseVocab`. Confirm-only — Appendix C gives it no auto option. */
export type PulseVocabProposal = { kind: PulseVocabProposalKind; value: string; mapsTo: string | null };

/** Whether a nutrition figure is the owner's own number or the coder's estimate of a typical portion. */
export type NutritionSource = 'stated' | 'estimated';

/**
 * What one pulse says the owner consumed (phase 5).
 *
 * Three states, and the difference between the last two is the whole point:
 *
 * - the field is **absent** — the utterance is not about the owner consuming
 *   anything. Someone else's dinner lands here too.
 * - the field is present with **`kcal: null`** — consumption the coder
 *   recognised and could not put a number on ("ate something at the buffet").
 *   Counted as uncounted, and shown as such, because a day that quietly drops
 *   a meal reads lower than it was.
 * - the field is present with a **number** — counted, and `kcalSource` says
 *   whether the owner stated it or the coder estimated a typical portion.
 *
 * `proteinG` is optional independently of `kcal`: a stated protein figure with
 * no calorie figure is a real thing to say, and so is the reverse.
 */
export type PulseNutrition = {
  kcal: number | null;
  kcalSource: NutritionSource;
  proteinG?: number;
  proteinSource?: NutritionSource;
};

/**
 * The owner asserting what a whole day came to (phase 5, rev 3).
 *
 * A different KIND of claim from `PulseNutrition`, which is about one item the
 * owner consumed. This is about a day, and it outranks the arithmetic: it is
 * the owner reading their own ledger and saying what the number should be.
 *
 * There is **no source field**, deliberately. A correction is owner-stated by
 * definition — the coder never produces one on its own initiative, only when
 * the owner asserts a day's total, so a `'stated' | 'estimated'` discriminant
 * would have exactly one reachable value.
 *
 * `date` is a local `YYYY-MM-DD` in the device's zone, resolved by the coder
 * against `now`/`tz` ("friday" ⇒ the date). Validated by round-trip, never by
 * a pattern — see `optionalCorrections`.
 *
 * `proteinG` is independently optional: correcting a day's calories without
 * mentioning protein is the common case, and the item sum still stands for it.
 */
export type PulseCorrection = { date: string; kcal: number; proteinG?: number };

/**
 * One captured utterance. Verbatim, timestamped, and never edited.
 *
 * `at` is a field rather than the event envelope's `ts`, which the plan's
 * letter names as the timestamp. It cannot be: `fold` returns fields and
 * throws the envelope away, so a stream reading its own `ts` would have no
 * clock to render and no instant for a span to start at. `at` is written once
 * at capture, alongside `text`, and is what every reader means by "when" —
 * the envelope still orders the fold, as it does for every other entity.
 *
 * `signal` through `vocabProposal` are enrichment: written once, together, by
 * the coder's own upsert (phase 2) — never by capture, and never carrying
 * `text` or `at` (fence 1). All are optional and all arrive together, so
 * `signal === undefined` is the one, total test for "uncoded": no separate
 * in-flight marker exists, and none should — see the coder's own file for why.
 *
 * `effects` and `vocabProposal` are stored rather than consumed in memory
 * (amendment 2026-08-29, extending Appendix A's field table). A coded pulse
 * is invisible to the coding sweep forever, so a proposal that lived only in
 * the sweep's local variable could never be regenerated: every pulse captured
 * before the chip UI ships would have no proposals at all, and Appendix C's
 * "dismiss drops the effect, keeps the coding" needs them to outlive a reload.
 * Fence 7 caps entities at two, not fields.
 */
export type PulseRow = {
  id: string;
  text: string;
  /** ISO instant of capture. */
  at: string;
  signal?: PulseSignal;
  domain?: string | null;
  activity?: string | null;
  people?: string[];
  span?: PulseSpan;
  links?: PulseLinks;
  /** Proposed, never applied. A dismissed chip is a write that removes its effect. */
  effects?: PulseEffect[];
  vocabProposal?: PulseVocabProposal | null;
  /** What the owner consumed, when the utterance says they consumed something. */
  nutrition?: PulseNutrition;
  /**
   * Day totals the owner asserted in this utterance. One pulse can correct
   * several days at once, and can carry `nutrition` for itself at the same
   * time — "had a burrito, 620; friday was 2400" is one line making two
   * different kinds of claim, and both are kept.
   */
  corrections?: PulseCorrection[];
  /**
   * Which revision of the coding schema produced these fields. Absent means
   * pre-rev-2 — coded before nutrition existed — which is what the backfill
   * tool selects on. Only the backfill reads it; the ambient sweep must never
   * consider it, or every re-open re-codes the whole history at the owner's
   * expense.
   */
  coderRev?: number;
};

/**
 * The pulse vocabulary: one instance, natural key `vocab`. Never resolved via
 * `resolveEntityId` — unlike `dailyEntry`/`habitCompletion`/`yearTheme`,
 * `pulseVocab` never existed in Postgres, so no legacy surrogate id can ever
 * fork from the sentinel every device writes to from its very first event.
 * Grows over time via approved `vocabProposal` chips (domain/activity/person)
 * — this row's seed is a starting point, not the only writer.
 */
export type PulseVocabRow = {
  id: string;
  domains: string[];
  /** label -> domain. */
  activities: Record<string, string>;
  people: string[];
};

// ============================================================================
// Field readers
// ============================================================================

/** A record's fields are whatever the journal said they were: check each one. */
type Record_ = Record<string, unknown>;

const HABIT_CATEGORIES: readonly HabitCategory[] = ['health', 'work', 'family', 'learning', 'other'];
const MIT_CATEGORIES: readonly MitCategory[] = ['work', 'self', 'family'];
export const TOWER_STATUSES: readonly TowerStatus[] = ['active', 'waiting', 'someday', 'done'];
const TOWER_EFFORTS: readonly TowerEffort[] = ['quick', 'medium', 'deep'];
const AI_TONES: readonly Profile['ai_tone'][] = ['stoic', 'friendly', 'wise'];

/** Stands in for a missing timestamp so a row never carries an empty string. */
const EPOCH_FLOOR = new Date(0).toISOString();

/** The profile's entity id before one has ever been written or seeded. */
const LOCAL_PROFILE_ID = 'profile';

/**
 * The pulseVocab entity's one and only id. Fixed, never derived or resolved:
 * every device that ever writes this entity targets this literal string.
 */
export const PULSE_VOCAB_ID = 'vocab';

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

/**
 * One of a closed set of schema values, or `fallback` where the stored value
 * is not in the set.
 *
 * The fallback is the whole difference between the three ways this is called,
 * and each one is a decision:
 *
 * - a schema default (`'stoic'`, `'active'`) — the column had one, so a row
 *   that lost its value reads the way the database would have read it;
 * - `null` — the column was nullable, and an absent value means nothing was
 *   chosen rather than something was;
 * - `undefined` — an enrichment that is genuinely optional, where absent means
 *   "not yet coded". An invalid value then reads the same as an absent one,
 *   never as a guess at what was meant.
 */
function oneOf<T extends string, F>(record: Record_, key: string, options: readonly T[], fallback: F): T | F {
  const value = record[key];
  for (const option of options) {
    if (value === option) return option;
  }
  return fallback;
}

/**
 * An array field, filtered to its string entries, or `fallback` where the
 * field is absent or is not an array at all.
 *
 * Absent and malformed deliberately read the same: a partial guess at a
 * garbled array is worse than not having one. `[]` is the fallback for a
 * column that always had a list; `undefined` for one that may simply not have
 * been written yet.
 */
function strArray<F>(record: Record_, key: string, fallback: F): string[] | F {
  const value = record[key];
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === 'string');
}

/** A plain-object field, filtered to its string-valued entries. Never throws on the wrong shape. */
function strRecord(record: Record_, key: string): Record<string, string> {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record_)) {
    if (typeof v === 'string') result[k] = v;
  }
  return result;
}

/** A nullable string field that may simply be absent. Garbage reads as absent, not as null. */
function optionalNullableStr(record: Record_, key: string): string | null | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

/** The coder's `span`, or undefined when absent or shaped wrong. */
function optionalSpan(record: Record_, key: string): PulseSpan | undefined {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const obj = value as Record_;
  if (typeof obj.start !== 'string') return undefined;
  return {
    start: obj.start,
    end: typeof obj.end === 'string' ? obj.end : null,
    approx: typeof obj.approx === 'boolean' ? obj.approx : false,
  };
}

/** The coder's `links`, or undefined when absent or shaped wrong. */
function optionalLinks(record: Record_, key: string): PulseLinks | undefined {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const obj = value as Record_;
  return { eventId: typeof obj.eventId === 'string' ? obj.eventId : null };
}

const NUTRITION_SOURCES: readonly NutritionSource[] = ['stated', 'estimated'];

/** An optional number field. Garbage — a string, a NaN, an Infinity — reads as absent, never as zero. */
function optionalNum(record: Record_, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The coder's `nutrition`, or undefined when absent, cleared, or shaped wrong.
 *
 * A stored `null` reads as absent on purpose: `null` is what a re-code writes
 * to clear a nutrition block it no longer stands behind, and "the coder says
 * this is not food" and "the coder never said anything" are the same fact for
 * every reader. The distinction the ledger cares about is the other one —
 * absent versus present-with-`kcal: null` — and that one survives here.
 *
 * `kcalSource` falls back to `estimated` rather than dropping the block. A
 * figure whose provenance failed its shape check is still a figure, and
 * calling it an estimate understates the app's confidence, which is the safe
 * direction. `proteinG` and `proteinSource` are independently optional.
 */
function optionalNutrition(record: Record_, key: string): PulseNutrition | undefined {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const obj = value as Record_;
  const kcal = optionalNum(obj, 'kcal');
  const nutrition: PulseNutrition = {
    kcal: kcal ?? null,
    kcalSource: oneOf(obj, 'kcalSource', NUTRITION_SOURCES, undefined) ?? 'estimated',
  };
  const proteinG = optionalNum(obj, 'proteinG');
  if (proteinG !== undefined) {
    nutrition.proteinG = proteinG;
    nutrition.proteinSource = oneOf(obj, 'proteinSource', NUTRITION_SOURCES, undefined) ?? 'estimated';
  }
  return nutrition;
}

/**
 * A bare local calendar date (`YYYY-MM-DD`), or null.
 *
 * A machine-defined format, so checking it exactly is allowed — and it is
 * checked by ROUND TRIP rather than by a pattern, which is both the fence and
 * the correct answer. `Date.parse` is not the check it looks like: it rolls
 * `2026-02-30` forward into March and accepts the extended-year form
 * `+002026-08-28`. Formatting the instant back out in UTC and requiring the
 * same string rejects both, and everything else that is not exactly a date.
 *
 * A correction naming a day that does not exist would silently apply to no
 * day at all — present in the journal, invisible in the ledger — which is the
 * worst of the available outcomes. Dropped here instead.
 */
function optionalDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const wall = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(wall)) return null;
  return dayKey(wall, 'UTC') === value ? value : null;
}

/**
 * The day totals the owner asserted. An entry that is not a usable claim is
 * dropped on its own; the rest of the array survives, because one unreadable
 * date in "friday was 2400 and saturday 1900" must not lose Saturday too.
 *
 * `kcal` must be a finite, non-negative number — a correction is the owner
 * putting a number on a day, and an entry without one is not a correction.
 */
function optionalCorrections(record: Record_, key: string): PulseCorrection[] | undefined {
  return Array.isArray(record[key]) ? parseCorrections(record[key]) : undefined;
}

/**
 * The same validation, over a value from anywhere.
 *
 * Exported because the coder parses the model's answer and this file parses
 * the journal record, and they are the same shape checked the same way. Two
 * copies would be two places to get the round-trip date check wrong, and the
 * one that drifted would be invisible — a correction that parsed on the way
 * in and vanished on the way out.
 */
export function parseCorrections(value: unknown): PulseCorrection[] {
  if (!Array.isArray(value)) return [];
  const corrections: PulseCorrection[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const obj = item as Record_;
    const date = optionalDate(obj.date);
    const kcal = optionalNum(obj, 'kcal');
    if (date === null || kcal === undefined || kcal < 0) continue;
    const correction: PulseCorrection = { date, kcal };
    const proteinG = optionalNum(obj, 'proteinG');
    if (proteinG !== undefined && proteinG >= 0) correction.proteinG = proteinG;
    corrections.push(correction);
  }
  return corrections;
}

export const PULSE_EFFECT_TYPES: readonly PulseEffectType[] = ['claimEvent'];
const PULSE_VOCAB_PROPOSAL_KINDS: readonly PulseVocabProposalKind[] = ['domain', 'activity', 'person'];

/**
 * The coder's proposed `effects`. An entry whose `type` is not one Appendix C
 * still lists is dropped rather than kept as an unrenderable chip; the rest of
 * the entry is carried through untouched, since each effect type carries its
 * own payload and this layer is not the place that reads it.
 *
 * This is also the whole handling of a retired type. The model may still answer
 * `completeHabit` — the prompt no longer offers it, but a prompt is not a
 * schema — and a stored journal line from before phase 4 certainly does. Both
 * drop here, silently: no error, no warning, no log. A retired proposal is not
 * a malformed one.
 */
function optionalEffects(record: Record_, key: string): PulseEffect[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const effects: PulseEffect[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const type = (item as Record_).type;
    if (typeof type === 'string' && (PULSE_EFFECT_TYPES as readonly string[]).includes(type)) {
      effects.push(item as PulseEffect);
    }
  }
  return effects;
}

/**
 * The coder's `vocabProposal`. An explicit `null` — "nothing to propose" — is
 * a real stored value and reads back as `null`; a malformed one reads as
 * absent rather than as a proposal with guessed parts.
 */
function optionalVocabProposal(record: Record_, key: string): PulseVocabProposal | null | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record_;
  const kind = obj.kind;
  if (typeof kind !== 'string' || !(PULSE_VOCAB_PROPOSAL_KINDS as readonly string[]).includes(kind)) return undefined;
  if (typeof obj.value !== 'string') return undefined;
  return {
    kind: kind as PulseVocabProposalKind,
    value: obj.value,
    mapsTo: typeof obj.mapsTo === 'string' ? obj.mapsTo : null,
  };
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
    reading_baseline_at: nullableTimestamp(record, 'reading_baseline_at', null),
    kcal_target: optionalNum(record, 'kcal_target') ?? null,
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
    effort: oneOf(record, 'effort', TOWER_EFFORTS, null),
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

function toReadItemRow(id: string, record: Record_): ReadItemRow {
  return { id, read_at: str(record, 'read_at', EPOCH_FLOOR) };
}

const PULSE_SIGNALS: readonly PulseSignal[] = ['block', 'event', 'state', 'plan', 'task', 'claim', 'note'];

/**
 * `signal` through `vocabProposal` are only ever set together, by one
 * enrichment upsert, so in practice all are present or none are. Each is
 * still read independently and defensively — a hand-edited journal, or a
 * future build's richer shape, must not throw here, and a value that fails
 * its own shape check reads as absent rather than as a guess.
 */
function toPulseRow(id: string, record: Record_): PulseRow {
  const row: PulseRow = { id, text: str(record, 'text', ''), at: str(record, 'at', EPOCH_FLOOR) };

  const signal = oneOf(record, 'signal', PULSE_SIGNALS, undefined);
  if (signal !== undefined) row.signal = signal;
  const domain = optionalNullableStr(record, 'domain');
  if (domain !== undefined) row.domain = domain;
  const activity = optionalNullableStr(record, 'activity');
  if (activity !== undefined) row.activity = activity;
  const people = strArray(record, 'people', undefined);
  if (people !== undefined) row.people = people;
  const span = optionalSpan(record, 'span');
  if (span !== undefined) row.span = span;
  const links = optionalLinks(record, 'links');
  if (links !== undefined) row.links = links;
  const effects = optionalEffects(record, 'effects');
  if (effects !== undefined) row.effects = effects;
  const vocabProposal = optionalVocabProposal(record, 'vocabProposal');
  if (vocabProposal !== undefined) row.vocabProposal = vocabProposal;
  const nutrition = optionalNutrition(record, 'nutrition');
  if (nutrition !== undefined) row.nutrition = nutrition;
  const corrections = optionalCorrections(record, 'corrections');
  if (corrections !== undefined) row.corrections = corrections;
  const coderRev = optionalNum(record, 'coderRev');
  if (coderRev !== undefined) row.coderRev = coderRev;

  return row;
}

function toPulseVocabRow(id: string, record: Record_): PulseVocabRow {
  return {
    id,
    domains: strArray(record, 'domains', []),
    activities: strRecord(record, 'activities'),
    people: strArray(record, 'people', []),
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
 * The reading corpus has no surrogate ids at all: `readItem` never existed in
 * Postgres, so nothing was ever seeded carrying one and the key IS the entity
 * id from the very first write. That is why `resolveEntityId` is not applied
 * to it — over rows whose ids are already their keys it is the identity.
 */
export function readItemKey(surface: string, itemKey: string): string {
  return `${surface}:${itemKey}`;
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
const serialize = queued();

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

export function readReadItemRows(): ReadItemRow[] {
  return rowsOf(ENTITY.readItem, toReadItemRow);
}

export function readPulseRows(): PulseRow[] {
  return rowsOf(ENTITY.pulse, toPulseRow);
}

/**
 * The pulse vocabulary, or null on a device that has never seeded or synced
 * one. A single fixed id, so — unlike `readProfile` — no merge is needed:
 * nothing can ever fork a second id holding this natural key.
 */
export function readPulseVocabRow(): PulseVocabRow | null {
  const record = bucket(ENTITY.pulseVocab)[PULSE_VOCAB_ID];
  return record ? toPulseVocabRow(PULSE_VOCAB_ID, record) : null;
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

/** Bytes of hex to mint where `crypto.randomUUID` is unavailable. */
const ID_BYTES = 16;

/**
 * A fresh id for an event or a row.
 *
 * `crypto.randomUUID` is secure-context-only and is simply absent when the app
 * is opened over plain http on the LAN, so `randomToken` falls back to
 * `getRandomValues`, which is not gated on a secure context.
 */
export function newId(): string {
  const id = randomToken(ID_BYTES);
  if (id === null) {
    throw new Error('this browser exposes no crypto random source, so no id can be minted');
  }
  return id;
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
    // Its own key. A successful push clears `lastBackupError`, and this is not
    // a push failure — sharing the key let a good backup erase a real local one.
    await setMeta('lastStateError', `the cached state could not be saved: ${detail}`);
  } catch {
    // The note lives in the same database that just refused the state. There
    // is nowhere left to record it, and the write itself is still safe.
  }
}
