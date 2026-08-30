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
  yearThemeKey,
} from '../lib/entities';
import type {
  DailyEntry,
  EventDraft,
  Habit,
  HabitCompletion,
  Profile,
  PulseEffect,
  PulseLinks,
  PulseRow,
  PulseVocabProposal,
  PulseVocabRow,
  ReadItemRow,
  Task,
  TowerItemRow,
  YearTheme,
} from '../lib/entities';
import { queued } from '../lib/async';
import { allCachedFiles, getMeta, setMeta } from '../lib/db';
import { dayKey, deviceTimeZone, eventsForDay } from '../lib/calendar';
import { loadCalendar } from '../lib/calendarSync';
import { compareCodeUnits } from '../lib/order';
import { compareOldestFirst, effectKey, effectString } from '../lib/pulse';
import { scheduleFlush } from '../lib/sync';
import { APPROX_COST_PER_PULSE_USD, CODER_REV, codePulse } from './coder';
import type { Coding, CoderContext, PulseEnrichment, RecentPulse } from './coder';
import type { HabitCategory, TowerStatus, TowerEffort, TowerItem, Pack, PackSession, PackWithCount } from '../types';

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

/** Ascending, with nulls after every value — Postgres `ASC NULLS LAST`. */
function compareNullsLast(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compareCodeUnits(a, b);
}

/** Descending, with nulls before every value — Postgres `DESC NULLS FIRST`. */
function compareDescNullsFirst(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;
  return compareCodeUnits(b, a);
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

interface HabitInput {
  label: string;
  description?: string | null;
  category: HabitCategory;
  emoji?: string | null;
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
 * Get all habits (non-archived by default)
 */
export async function getHabits(includeArchived = false): Promise<Habit[]> {
  await hydrate();

  const rows = readHabits().filter((habit) => includeArchived || habit.archived_at === null);
  return rows.sort((a, b) => a.sort_order - b.sort_order || compareCodeUnits(a.id, b.id));
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
export async function updateHabit(id: string, updates: Partial<Omit<Habit, 'id' | 'created_at'>>): Promise<Habit> {
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

// ============================================================================
// Daily Entries (focus + reflection)
// ============================================================================

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
    .sort((a, b) => compareCodeUnits(a.date, b.date) || compareCodeUnits(a.id, b.id));
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
 * Reading order for a span of days: date, then category, then `sort_order` —
 * the position the owner dragged the task to, as recorded in the journal.
 * Skipping it would leave the list in whatever order the uuids happened to
 * fall in, which is the order the MITs render in.
 *
 * The write path that assigned `sort_order` is gone: nothing has created a
 * task since the MIT editor was retired. This reader stays because the
 * journal still holds those rows and the week view still draws them.
 */
function compareTasks(a: Task, b: Task): number {
  return (
    compareCodeUnits(a.date, b.date) ||
    compareCodeUnits(a.category, b.category) ||
    a.sort_order - b.sort_order ||
    compareCodeUnits(a.id, b.id)
  );
}

// ============================================================================
// Year Themes
// ============================================================================

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
 * Get the profile
 */
export async function getProfile(): Promise<Profile> {
  await hydrate();

  // A device that has never written a profile still has one, with the column
  // defaults the table used to fill in.
  return readProfile() ?? toProfile(profileEntityId(), {});
}

/**
 * Update the profile
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
 * then cannot clobber the verbatim line no matter when this lands.
 *
 * An enrichment landing after a delete still resurrects the entity at the
 * journal level — that is the fold's contract for all twelve entities and is
 * not negotiable here. What changed is that `readPulseRows` no longer returns
 * such a row, and this guard keeps the orphan out of the journal in the first
 * place on the one device that can see the delete.
 *
 * The guard is best-effort by construction. A row absent from this session is
 * indistinguishable from one deleted a moment ago, so a `resetSession()`
 * landing mid-call (L4) also skips the write. That costs a coder round trip —
 * the pulse stays uncoded and the sweep picks it up again — where writing
 * blind would cost a resurrected ghost. Still no throw and no log.
 *
 * `links` is the one field this MERGES rather than replaces (see `mergeLinks`),
 * and the read it needs is why this queues with the chip applies: the same
 * field is read-modify-written on both paths.
 */
export async function enrichPulse(id: string, coding: Coding, scope: EnrichmentScope = 'full'): Promise<void> {
  return serializePulseWrite(async () => {
    await hydrate();
    const existing = readPulseRows().find((row) => row.id === id);
    // Belt for the single-device race: captured, coded, deleted while the coder
    // ran, enrichment lands last. `readPulseRows` already hides the ghost from
    // every reader, so this only keeps the orphan out of the journal. No throw,
    // no log — a deleted pulse is not an error, it is the owner's decision.
    if (existing === undefined) return;
    // Every field of the coding except the two fence 1 forbids. `effects` and
    // `vocabProposal` are stored rather than held in memory: a coded pulse is
    // invisible to the sweep forever, so a proposal that lived only in the
    // sweep's local variable could never be regenerated, and Appendix C's
    // "dismiss drops the effect, keeps the coding" needs it to survive a reload.
    const coded: Omit<Coding, 'effects' | 'vocabProposal'> = {
      signal: coding.signal,
      domain: coding.domain,
      activity: coding.activity,
      people: coding.people,
      span: coding.span,
      links: mergeLinks(existing.links, coding.links),
      nutrition: coding.nutrition,
      corrections: coding.corrections,
      coderRev: coding.coderRev,
    };
    const fields: Record<string, unknown> =
      scope === 'full'
        ? { ...coded, effects: coding.effects, vocabProposal: coding.vocabProposal }
        : { ...coded };
    await commit([{ entity: ENTITY.pulse, entityId: id, type: 'upsert', fields }]);
  });
}

/**
 * How much of a coding an enrichment writes.
 *
 * `full` is the ambient path: the coding plus the proposals it produced, which
 * become the chips under the line.
 *
 * `codingOnly` is the backfill's, and it omits `effects` and `vocabProposal`
 * from the event ENTIRELY rather than writing them empty. Two different
 * things, and the difference is visible on screen: the plan says a backfill
 * produces "no chips about last Tuesday", which is a rule about not creating
 * proposals — writing `[]` and `null` would go further and silently destroy a
 * proposal already sitting there unanswered, turning a re-code into a sweep
 * that clears the owner's inbox. A field this never mentions is a field
 * last-writer-wins leaves exactly as it was.
 */
type EnrichmentScope = 'full' | 'codingOnly';

/**
 * The coder's `links`, with anything already recorded on the row left alone.
 *
 * A chip apply records a FACT — this pulse claimed that event. An enrichment
 * only PROPOSES, and a recorded fact outranks a fresh proposal. The other
 * device re-coding a pulse whose enrichment has not reached it yet answers
 * with a null link, and writing that wholesale would erase the claim.
 *
 * So a sub-key already holding a value survives and only the nulls are filled
 * from the coding. A row that does not exist has nothing to keep: an
 * enrichment landing after a delete resurrects the pulse carrying the coding's
 * own links, which is the pinned behaviour (P2), unchanged.
 *
 * One sub-key is left (phase 4) and the merge still earns its place: the whole
 * point is that a claim already recorded outlives a re-code that knows nothing
 * about it.
 */
function mergeLinks(existing: PulseLinks | undefined, proposed: PulseLinks): PulseLinks {
  if (existing === undefined) return proposed;
  return { eventId: existing.eventId ?? proposed.eventId };
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
  // Phase 5. The label is for the ledger's own rows; nutrition extraction is
  // NOT gated on it — a drink at a work dinner is `social` and still food.
  // Seeding is once-ever and idempotent, so a device that seeded before this
  // line existed never gains it, and nothing needs it to.
  eating: 'self',
};

const PULSE_VOCAB_SEED_PEOPLE = ['wife', 'kids'];

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
  if (existing !== null) return existing;

  const seedFields = {
    domains: PULSE_VOCAB_SEED_DOMAINS,
    activities: PULSE_VOCAB_SEED_ACTIVITIES,
    people: PULSE_VOCAB_SEED_PEOPLE,
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
 * Applying touches two things — what the effect names, and the pulse's own
 * `effects` list, which the applied effect has to leave. Split across two
 * commits, a failure between them leaves the chip on screen with the write
 * already done, and the next tap repeats it.
 *
 * `commit` takes an array and turns it into one `enqueue` (`entities.ts`), so
 * both writes land or neither does.
 *
 * Phase 4 left one effect here, and it is the mildest of the four: a claim is
 * a field on the pulse itself, so an apply is a single upsert either way. The
 * rule stays because the shape does — the three that could mint or tick
 * something elsewhere were the reason for it, and re-adding one must re-inherit
 * it rather than rediscover it.
 */

/** No link at all — what a pulse coded before `links` existed reads as. */
const NO_LINKS: PulseLinks = { eventId: null };

/**
 * Every read-modify-write of a pulse's own `effects` and `links` runs one at
 * a time.
 *
 * Both fields are written whole: an apply rewrites the effects list without
 * the one it took, and sets a link beside whatever was already there. Run
 * concurrently — two chips tapped in the same second, or a tap landing while
 * the auto-apply pass walks a fresh coding's own effects — the second write
 * is built from a row read before the first one landed, and the first's work
 * is simply overwritten.
 *
 * The lock lives here rather than in the hook because the background
 * auto-apply path never goes near the hook, and a lock only one of the two
 * paths takes is not a lock. Same promise-chain shape as `entities.ts`'s
 * `serialize` and `sync.ts`'s `serialized`, for the same reason.
 */
const serializePulseWrite = queued();

/** The pulse-side half of an apply: the effect leaves the list, and stays gone. */
function withoutEffect(row: PulseRow, index: number): Record<string, unknown> {
  return { effects: (row.effects ?? []).filter((_, at) => at !== index) };
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
  await hydrate();

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
 * to map to is not written — Appendix A's shape is `label -> domain`, and half
 * an entry is worse than none for the ledger, which reads nothing else.
 */
function vocabFieldsFor(
  vocab: PulseVocabRow,
  proposal: PulseVocabProposal
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
  const vocab = await ensurePulseVocabSeeded();

  const row = readPulseRows().find((candidate) => candidate.id === pulseId);
  const proposal = row?.vocabProposal;
  if (row === undefined || proposal === undefined || proposal === null) return;

  const fields = vocabFieldsFor(vocab, proposal);
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
 * `claimEvent` on after a fortnight of coded pulses gets no burst of claims
 * against proposals that have been sitting there; a sweep over the store
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
    const initial = readPulseRows().find((row) => row.id === pulseId)?.effects?.length ?? 0;
    for (let remaining = initial; remaining > 0; remaining -= 1) {
      const effects = readPulseRows().find((row) => row.id === pulseId)?.effects ?? [];
      const effect = effects[0];
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
              links: other.links ?? { eventId: null },
            } satisfies PulseEnrichment),
    }));
}

/**
 * Assembles exactly the slices Appendix B's allowlist names, and nothing else
 * (fence 5).
 *
 * Phase 4 took three of them out, and fence 9 is why: `todayHabits`,
 * `openTowerItems` and `mouth` are gone, so no habit and no tower item is ever
 * handed to a model again. Nothing here reads the habit store or the tower
 * store at all now — the allowlist is a subset test, and this is the assembly
 * it is tested against.
 */
async function buildCoderContext(row: PulseRow, allRows: readonly PulseRow[]): Promise<CoderContext> {
  const tz = deviceTimeZone();
  // The pulse's own local day, not the sweep's. The queue is lazy by design,
  // so this runs hours or days after capture; a Thursday utterance shown
  // Saturday's calendar would be coded against a day it has nothing to do
  // with. See `CoderContext.now` for the reading of Appendix B this follows.
  const day = dayKey(Date.parse(row.at), tz);

  const [vocab, mirror] = await Promise.all([ensurePulseVocabSeeded(), loadCalendar()]);

  return {
    now: row.at,
    tz,
    vocab: {
      domains: vocab.domains,
      activities: vocab.activities,
      people: vocab.people,
    },
    todayEvents: eventsForDay(mirror, day, tz).map((event) => ({
      id: event.id,
      title: event.title,
      calendar: event.calendar,
      start: event.start,
      end: event.end,
    })),
    recentPulses: recentPulsesFor(row, allRows),
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
 * second set of proposals, and applies them again. The second read is not a
 * duplicate of the first: `buildCoderContext` awaits the vocab seed and the
 * calendar between them, which is a second window of exactly the same shape.
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

  await catchUpToCurrentRev(signal);
}

/**
 * Bring pulses coded by an older build up to this one's `CODER_REV` — once per
 * revision, by itself, with nothing for the owner to find or press.
 *
 * **This is not the ambient sweep considering `coderRev`, and the distinction
 * is the whole safety argument.** The fence exists because a sweep that re-codes
 * everything below the current rev would re-bill the entire history on every
 * single open, silently, forever. What gates this is `codedAtRev` — a
 * device-local mark written only after a clean pass — so the work happens at
 * most once per revision per device and every later open costs nothing. The
 * regression test for the fence still stands: with `codedAtRev` already at the
 * current rev, an open makes no call at all.
 *
 * Why it is automatic rather than a button: a rev bump can mean a stored coding
 * is actively wrong — rev 4 fixed meals placed at the wrong hour, which silently
 * drop out of a day's total — and a fix the owner has to notice, understand and
 * go press is a fix that does not land. The bill is bounded by the history, paid
 * once, and a bump only happens when the coder itself changed.
 *
 * `MAX_PULSES_PER_SWEEP` bounds each pass and the mark is only written when a
 * pass finds nothing left, so a long history finishes over several opens and a
 * partial or failing run simply resumes. A failed pulse keeps its old rev and is
 * found again, which is the entire retry story (fence 2).
 */
async function catchUpToCurrentRev(signal?: AbortSignal): Promise<void> {
  if ((await getMeta<number>('codedAtRev', 0)) === CODER_REV) return;

  const rows = await getPulses();
  const behind = pulsesToBackfill(rows);
  if (behind.length === 0) {
    await setMeta('codedAtRev', CODER_REV);
    return;
  }

  let attempts = 0;
  for (const row of behind) {
    if (signal?.aborted) return;
    if (attempts >= MAX_PULSES_PER_SWEEP) return;
    attempts += 1;
    await recodeRow(row, rows);
  }
  scheduleFlush();
}

// ============================================================================
// Pulse coding backfill (owner-invoked)
// ============================================================================

/**
 * The Phase 1 ship date — the first day a pulse could exist.
 *
 * The backfill's floor, and the reason it has one: it bounds the work to
 * pulses this app actually wrote, so a hand-restored journal carrying rows
 * from some earlier life cannot turn one tap into an unbounded bill.
 */
export const PULSE_EPOCH = '2026-08-27T00:00:00.000Z';

/**
 * Which pile to work through. `uncoded` is the backlog the owner is owed;
 * `staleRev` is the deliberate re-code of history at the current revision.
 */
export type CodingWork = 'uncoded' | 'staleRev';

/** What the backfill has done so far, and what is left. */
export type BackfillProgress = {
  done: number;
  failed: number;
  total: number;
};

/**
 * A pulse this replica captured and never coded. `signal` is the one, total
 * test for uncoded — every enrichment field arrives together.
 */
function isUncoded(row: PulseRow): boolean {
  return row.signal === undefined;
}

/** In scope for any coding work: captured at or after `PULSE_EPOCH`, with a readable `at`. */
function inBackfillScope(row: PulseRow): boolean {
  const atMs = Date.parse(row.at);
  return Number.isFinite(atMs) && atMs >= Date.parse(PULSE_EPOCH);
}

/**
 * The pulses that were never coded at all — the backlog, and the only number
 * that answers "is anything still owed?".
 *
 * Split out from `pulsesToBackfill`, which used to include these. That was the
 * plan's wording read literally (an uncoded pulse has no `coderRev` either) and
 * it made the count useless the day a revision shipped: measured on the real
 * journal, one pulse was genuinely uncoded and eighteen were already coded at
 * rev 2, so the owner was shown "19 pulses, roughly $0.19" when the answer to
 * their question was one. Two disjoint sets, two numbers, two decisions.
 *
 * Oldest first, for the reason the backfill is.
 */
export function pulsesToCode(rows: readonly PulseRow[]): PulseRow[] {
  return rows.filter((row) => inBackfillScope(row) && isUncoded(row)).sort(compareOldestFirst);
}

/**
 * The pulses a re-code would upgrade: captured at or after `PULSE_EPOCH`,
 * already coded, and at a revision older than this build's.
 *
 * Coded is now a requirement rather than an accident. An uncoded pulse belongs
 * to `pulsesToCode`, and the ambient sweep — which now also runs on foreground,
 * not only on open — reaches it without the owner paying attention to anything.
 *
 * **Newest first**, which is a reversal. Oldest-first was right while this was
 * a button the owner pressed and watched: a stopped run had finished the oldest
 * half, and pressing again resumed where the eye left off. Now that the
 * catch-up runs by itself, a few per foreground, the order decides WHEN the
 * owner sees anything change — and what they are looking at is this week.
 * Measured: rev 4 fixed a Saturday dinner placed at the wrong hour, the
 * catch-up got through nine pulses from days earlier, and the owner reloaded
 * repeatedly and reported "nothing is changing", because the one row they
 * could see was last in a queue of twenty-seven.
 *
 * Oldest first, so a run that is stopped halfway has done the oldest half and
 * a rerun picks up where the eye left off. A row whose `at` cannot be read as
 * an instant is skipped for the reason the sweep skips it: there is no moment
 * to resolve the utterance against.
 */
export function pulsesToBackfill(rows: readonly PulseRow[]): PulseRow[] {
  return rows
    .filter((row) => inBackfillScope(row) && !isUncoded(row) && (row.coderRev ?? 0) < CODER_REV)
    .sort((a, b) => compareOldestFirst(b, a));
}

/** One button's worth of work: how many pulses, and roughly what they would cost. */
export type CodingScope = { count: number; approxCostUsd: number };

function scopeOf(rows: readonly PulseRow[]): CodingScope {
  return { count: rows.length, approxCostUsd: rows.length * APPROX_COST_PER_PULSE_USD };
}

/**
 * The two disjoint piles of coding work, counted together so the numbers on
 * screen cannot disagree about the same journal.
 *
 * `uncoded` is what the owner means by "is anything not done?"; `staleRev` is
 * the Gate 5 catch-up tool, which is a different decision at a different price.
 */
export async function countPulseCodingWork(): Promise<{ uncoded: CodingScope; staleRev: CodingScope }> {
  const rows = await getPulses();
  return { uncoded: scopeOf(pulsesToCode(rows)), staleRev: scopeOf(pulsesToBackfill(rows)) };
}

/**
 * Re-code one pulse at the current revision, keeping only the coding.
 *
 * Deliberately NOT `codeRow`. That one returns early when the pulse is
 * already coded — which is right for the ambient sweep and exactly wrong
 * here, since re-coding an already-coded pulse is the entire job. It also
 * runs `autoApplyEffects`, and this path has no effects to apply: a backfill
 * that could tick something in the app would be a fortnight of history
 * reaching forward into today.
 *
 * What it does share is `codingInFlight`, so a backfill and an ambient sweep
 * that overlap cannot bill the same pulse twice.
 *
 * Never throws: a failure of any shape leaves the pulse at its old revision,
 * where the next run will find it again. That is the whole retry story —
 * there is no ladder (fence 2).
 */
async function recodeRow(row: PulseRow, allRows: readonly PulseRow[]): Promise<boolean> {
  if (codingInFlight.has(row.id)) return false;
  codingInFlight.add(row.id);
  try {
    const context = await buildCoderContext(row, allRows);
    const coding = await codePulse(row.text, context);
    if (!coding) return false;
    await enrichPulse(row.id, coding, 'codingOnly');
    scheduleFlush();
    return true;
  } catch {
    return false;
  } finally {
    codingInFlight.delete(row.id);
  }
}

/**
 * Re-code every pulse below the current revision, one at a time.
 *
 * Owner-invoked, one-shot in spirit and idempotent in mechanism: each success
 * writes `coderRev`, so the same pulse is out of scope on the next run and a
 * stopped or half-failed run is resumed simply by pressing the button again.
 *
 * Sequential for the reason the sweep is: a backlog should not become a burst
 * of concurrent paid calls. `signal` stops it between pulses — a call already
 * in flight has been paid for and is allowed to store its answer.
 *
 * `onProgress` is called after every pulse, success or not, so the count on
 * screen moves even through a run that is failing.
 */
export async function backfillPulseCoding(
  which: CodingWork,
  onProgress?: (progress: BackfillProgress) => void,
  signal?: AbortSignal
): Promise<BackfillProgress> {
  const rows = await getPulses();
  const targets = which === 'uncoded' ? pulsesToCode(rows) : pulsesToBackfill(rows);

  const progress: BackfillProgress = { done: 0, failed: 0, total: targets.length };
  for (const row of targets) {
    if (signal?.aborted) return progress;
    if (await recodeRow(row, rows)) progress.done += 1;
    else progress.failed += 1;
    onProgress?.({ ...progress });
  }
  return progress;
}

// ============================================================================
// Bulk Data Loading
// ============================================================================

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
    .sort((a, b) => compareCodeUnits(a.date, b.date) || compareCodeUnits(a.id, b.id));

  const completions = readMergedHabitCompletions()
    .filter((row) => inRange(row.date, startDate, endDate))
    .sort((a, b) => compareCodeUnits(a.date, b.date) || compareCodeUnits(a.id, b.id));

  const tasks = readTasks()
    .filter((row) => inRange(row.date, startDate, endDate))
    .sort(compareTasks);

  return { entries, completions, tasks };
}

// ============================================================================
// Additional Utility Functions
// ============================================================================

/**
 * Get all year themes
 */
export async function getAllYearThemes(): Promise<YearTheme[]> {
  await hydrate();

  return readMergedYearThemes().sort(
    (a, b) => b.year - a.year || compareCodeUnits(a.id, b.id)
  );
}

/**
 * Get all completion dates for a habit
 * Returns an array of date strings (YYYY-MM-DD)
 */
export async function getHabitCompletionDates(habitId: string): Promise<string[]> {
  await hydrate();

  return readMergedHabitCompletions()
    .filter((row) => row.habit_id === habitId)
    .sort((a, b) => compareCodeUnits(b.date, a.date) || compareCodeUnits(a.id, b.id))
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
    compareCodeUnits(a.id, b.id)
  );
}

/**
 * Get all tower items (excludes done by default)
 */
export async function getTowerItems(includeDone = false): Promise<TowerItem[]> {
  await hydrate();

  return readTowerItemRows()
    .filter((row) => includeDone || row.status !== 'done')
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
 * Get all packs (non-archived by default)
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
    .sort((a, b) => compareDescNullsFirst(a.created_at, b.created_at) || compareCodeUnits(a.id, b.id))
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
    .sort((a, b) => compareCodeUnits(b.date, a.date) || compareCodeUnits(a.id, b.id))
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
 * Delete a pack session
 */
export async function deletePackSession(id: string): Promise<void> {
  await hydrate();

  if (!readPackSessionRows().some((row) => row.id === id)) return;
  await commit([{ entity: ENTITY.packSession, entityId: id, type: 'delete' }]);
}

// Re-export types for convenience
export type { Habit, DailyEntry, HabitCompletion, Task, YearTheme, Profile, TowerItemRow } from '../lib/entities';
