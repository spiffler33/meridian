/**
 * The ledger: what the coded stream adds up to.
 *
 * Phase 3 is arithmetic and nothing else. Every number here is a sum over
 * spans the coder already classified — no trend, no target, no comparison to
 * an ideal, no reading of what any of it means (fence 6). A pulse the coder
 * never reached contributes nothing and is counted separately, because a week
 * that lost nine pulses to a dead network must not read as a quiet week.
 *
 * Pure, the way `journal.ts` and `pulse.ts` are pure: no IndexedDB, no fetch,
 * no React. Clock and zone arrive as arguments so a test can pin a week
 * without pinning the machine it runs on.
 *
 * Every instant here is epoch ms. The one place a local calendar day matters —
 * the day-end cap, the histogram's hour, a week's edges — goes through
 * `Intl.DateTimeFormat` parts, never through a formatted string and never
 * through `slice(0, 10)`, for the reason `dayKey` gives: a UTC slice buckets
 * an evening pulse west of Greenwich onto tomorrow.
 */

import { dayKey } from './calendar';
import type { CalendarEvent, CalendarMirror } from './calendar';
import type { PulseCorrection, PulseRow, PulseSignal } from './entities';
import { partsOf, zoneFormat } from './intlParts';
import { compareCodeUnits } from './order';
import { compareOldestFirst } from './pulse';
import { addDays, getWeekDates } from '../utils/dates';

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Appendix D's cap on an open block, and the one number in this file the
 * owner is expected to change. Tunable at Gate 3: if four hours is producing
 * dishonest Saturdays, this is the line to edit.
 */
export const OPEN_BLOCK_CAP_MS = 4 * MS_PER_HOUR;

/**
 * The signals that carry duration into Spent, and — the same set — the ones
 * that close an open block.
 *
 * Appendix D names the closing set outright ("closed by the next `block` or
 * `event` pulse's start") and rules out `state`/`note`/`plan` from carrying
 * duration. It leaves `task` and `claim` unstated in both places, so this is
 * an interpretation and is written down as one. Neither is time spent: a
 * `task` is a thing not yet done, and a `claim` exists to flip a calendar
 * event onto the *Needed* side, where counting it again as Spent would be the
 * same hour billed twice. Gate 3 can overrule it by editing this line.
 */
const SPENT_SIGNALS: readonly PulseSignal[] = ['block', 'event'];

/** Appendix A's calendar whose hours are not the owner's until a pulse claims one. */
const HOME_CALENDAR = 'home';

/**
 * The timing histogram's trailing window, in weeks.
 *
 * One week is not enough to answer "when does this happen": a habit done three
 * times gives three points across twenty-four buckets, which is noise wearing
 * a chart's clothes. Twelve weeks is long enough to have a shape and short
 * enough that a shape which changed is visible.
 */
export const HISTOGRAM_WEEKS = 12;

/**
 * How many activity rows the strip draws. The rest are counted in a footnote,
 * never silently dropped.
 *
 * Unlike domains, activities are an open set: the coder answers a short label
 * and may answer one the vocabulary does not hold yet. Twelve weeks of an
 * ordinary life is a dozen or more of them, and a phone screen of twenty
 * heat strips answers nothing. The busiest are the ones the question is about.
 */
export const TIMING_ROWS = 8;

/** A half-open-ish instant range; both ends inclusive, `endMs` being the last ms of the last day. */
export type LedgerWindow = { startMs: number; endMs: number };

// ============================================================================
// Local time, without trusting a formatted string
// ============================================================================

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/**
 * An instant's wall clock in a zone.
 *
 * `hourCycle: 'h23'` is load-bearing: an en-US default renders midnight as
 * hour 24 on some engines and 0 on others, and a 24 pushes every
 * early-morning pulse into the following day's histogram bucket.
 */
function wallClockOf(instantMs: number, timeZone: string): WallClock {
  const parts = zoneFormat(timeZone).formatToParts(new Date(instantMs));
  const find = (type: string) => Number(partsOf(parts, type) ?? '0');
  return {
    year: find('year'),
    month: find('month'),
    day: find('day'),
    hour: find('hour'),
    minute: find('minute'),
    second: find('second'),
  };
}

/** The zone's offset from UTC at an instant, in ms. Seconds are the finest the parts carry. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const wall = wallClockOf(instantMs, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant a local wall-clock moment falls on.
 *
 * Two passes, because the offset that converts the answer is the offset *at*
 * the answer, not at the guess: one pass is wrong by an hour on either side of
 * a DST change. A wall time that a spring-forward skipped has no instant at
 * all; the second pass lands on the moment the clock jumped to, which is the
 * only defined thing to do with it.
 */
function instantOfWall(wallAsUtcMs: number, timeZone: string): number {
  const guess = wallAsUtcMs - zoneOffsetMs(wallAsUtcMs, timeZone);
  return wallAsUtcMs - zoneOffsetMs(guess, timeZone);
}

/** Midnight opening a local date, as an instant. `NaN` for a date that is not one. */
export function startOfLocalDayMs(date: string, timeZone: string): number {
  const wall = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(wall)) return NaN;
  return instantOfWall(wall, timeZone);
}

/** The last millisecond of the local day an instant falls on — Appendix D's "23:59 local". */
export function endOfLocalDayMs(instantMs: number, timeZone: string): number {
  return startOfLocalDayMs(addDays(dayKey(instantMs, timeZone), 1), timeZone) - 1;
}

/** The local hour an instant falls in, 0–23. The histogram's bucket. */
export function localHour(instantMs: number, timeZone: string): number {
  return wallClockOf(instantMs, timeZone).hour;
}

/**
 * The local week containing a date, as instants.
 *
 * `weekStartsOn` is the app's own setting rather than a constant here, so the
 * ledger's week and the "this week" lens directly above it can never disagree
 * about which days they are counting.
 */
export function weekWindow(date: string, timeZone: string, weekStartsOn: 0 | 1 = 1): LedgerWindow {
  const days = getWeekDates(date, weekStartsOn);
  return {
    startMs: startOfLocalDayMs(days[0], timeZone),
    endMs: startOfLocalDayMs(addDays(days[6], 1), timeZone) - 1,
  };
}

/** The trailing `weeks` window ending with the one `window` belongs to. */
export function trailingWindow(window: LedgerWindow, weeks: number, timeZone: string): LedgerWindow {
  const firstDay = dayKey(window.startMs, timeZone);
  return { startMs: startOfLocalDayMs(addDays(firstDay, -7 * (weeks - 1)), timeZone), endMs: window.endMs };
}

/** How much of a range falls inside a window, in ms. Zero when they miss each other. */
function overlapMs(startMs: number, endMs: number, window: LedgerWindow): number {
  const from = Math.max(startMs, window.startMs);
  const to = Math.min(endMs, window.endMs + 1);
  return to > from ? to - from : 0;
}

// ============================================================================
// Appendix D — closing a span
// ============================================================================

/**
 * One classified span with both ends known.
 *
 * `derived` says the end was computed here rather than stated by the coder,
 * which is the difference between an hour the owner reported and an hour this
 * file guessed. The UI says so; a number that cannot tell them apart is a
 * number that reads as measured when it is inferred.
 */
export type ClosedSpan = {
  pulseId: string;
  signal: PulseSignal;
  domain: string | null;
  activity: string | null;
  startMs: number;
  endMs: number;
  derived: boolean;
};

/**
 * Every span the ledger can add up, both ends closed. Appendix D, in order.
 *
 * Takes ALL pulses rather than a window's, deliberately, and twice over: rule
 * 2 closes a block at the *next* one, which can be the far side of a week
 * edge, and a span opened on Sunday night is partly Monday's. Clipping is the
 * caller's job, after the ends are known — clip first and Monday's first block
 * would close itself at the cap every time.
 *
 * A pulse with no coding, a coding outside `SPENT_SIGNALS`, or an unreadable
 * `span.start` is not here. None of those is an error: an uncoded pulse is a
 * valid state the honesty line counts, and the fence forbids inventing a
 * classification for it.
 */
export function closeSpans(pulses: readonly PulseRow[], timeZone: string): ClosedSpan[] {
  const open: Array<{ pulse: PulseRow; startMs: number }> = [];
  for (const pulse of pulses) {
    if (pulse.signal === undefined) continue;
    if (!SPENT_SIGNALS.includes(pulse.signal)) continue;
    const startMs = Date.parse(pulse.span?.start ?? '');
    if (!Number.isFinite(startMs)) continue;
    open.push({ pulse, startMs });
  }

  // By start, then id — the same final tiebreak `compareOldestFirst` and the
  // fold both use, so two devices closing the same week agree on which block
  // closed which. Array order would make the answer depend on fetch order.
  open.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return compareCodeUnits(a.pulse.id, b.pulse.id);
  });

  const closed: ClosedSpan[] = [];
  for (let i = 0; i < open.length; i += 1) {
    const { pulse, startMs } = open[i];

    // Rule 1 — stated. Unconditional, as Appendix D writes it: the owner said
    // two hours, so it is two hours, even where the next block starts inside
    // them. Two stated spans can therefore overlap and bill the same hour
    // twice; capping a stated duration would be this file overruling the
    // owner, which is a Gate 3 decision and not one to take quietly here.
    const statedEnd = pulse.span?.end == null ? NaN : Date.parse(pulse.span.end);
    if (Number.isFinite(statedEnd) && statedEnd > startMs) {
      closed.push(spanOf(pulse, startMs, statedEnd, false));
      continue;
    }

    // Rules 2 and 3, "whichever first": the next block or event, the cap, and
    // the end of the local day, whichever comes soonest. The day-end is what
    // stops a block said at 23:00 from swallowing the small hours of tomorrow.
    const nextStart = i + 1 < open.length ? open[i + 1].startMs : Number.POSITIVE_INFINITY;
    const endMs = Math.min(nextStart, startMs + OPEN_BLOCK_CAP_MS, endOfLocalDayMs(startMs, timeZone));
    if (endMs <= startMs) continue;
    closed.push(spanOf(pulse, startMs, endMs, true));
  }
  return closed;
}

function spanOf(pulse: PulseRow, startMs: number, endMs: number, derived: boolean): ClosedSpan {
  return {
    pulseId: pulse.id,
    signal: pulse.signal as PulseSignal,
    domain: pulse.domain ?? null,
    activity: pulse.activity ?? null,
    startMs,
    endMs,
    derived,
  };
}

// ============================================================================
// Spent — hours by domain
// ============================================================================

/**
 * One bar. `domain: null` is a coded pulse the coder gave no domain to — real
 * hours that belong to no column, shown rather than dropped, because hours
 * that vanish make the week look lighter than it was.
 */
export type DomainHours = { domain: string | null; hours: number; derivedHours: number };

/**
 * Hours by domain inside a window, largest first.
 *
 * Every span is clipped to the window, so a block running across Sunday
 * midnight gives each week only its own side of it.
 */
export function spentByDomain(spans: readonly ClosedSpan[], window: LedgerWindow): DomainHours[] {
  const totals = new Map<string | null, { hours: number; derivedHours: number }>();
  for (const span of spans) {
    const ms = overlapMs(span.startMs, span.endMs, window);
    if (ms <= 0) continue;
    const entry = totals.get(span.domain) ?? { hours: 0, derivedHours: 0 };
    entry.hours += ms / MS_PER_HOUR;
    if (span.derived) entry.derivedHours += ms / MS_PER_HOUR;
    totals.set(span.domain, entry);
  }
  return [...totals.entries()]
    .map(([domain, entry]) => ({ domain, ...entry }))
    .sort(compareBars);
}

/** Biggest first; ties by name, and the domainless column last whatever it weighs. */
function compareBars(a: { domain: string | null; hours: number }, b: { domain: string | null; hours: number }): number {
  if (a.domain === null !== (b.domain === null)) return a.domain === null ? 1 : -1;
  if (a.hours !== b.hours) return b.hours - a.hours;
  return compareCodeUnits(a.domain ?? '', b.domain ?? '');
}

// ============================================================================
// Needed — hours by calendar
// ============================================================================

/** Every calendar event a pulse has claimed, by event id. */
export function claimedEventIds(pulses: readonly PulseRow[]): Set<string> {
  const ids = new Set<string>();
  for (const pulse of pulses) {
    const eventId = pulse.links?.eventId;
    if (typeof eventId === 'string' && eventId.length > 0) ids.add(eventId);
  }
  return ids;
}

/**
 * One calendar's committed hours, and what was left out of them.
 *
 * `allDay` is a count, not hours. An all-day event carries no clock, so it
 * carries no duration: billing it at 24 h would bury every real meeting under
 * a birthday, and inventing a smaller number would be a figure nobody said.
 * The app already treats all-day this way — `AllDayChip` renders no time
 * because "the absence is the signal" — so the count sits beside the bar.
 *
 * `unclaimed` is the home calendar's other half: hours on the shared calendar
 * that no pulse has claimed, which the plan says count zero. Shown, because a
 * zero that is really "nine unclaimed hours" is a different fact.
 */
export type CalendarHours = { calendar: string; hours: number; allDay: number; unclaimed: number };

/** An event's instants, or null when the mirror's dates cannot be read. */
function eventRange(event: CalendarEvent, timeZone: string): { startMs: number; endMs: number } | null {
  if (event.allDay) {
    const startMs = startOfLocalDayMs(event.start, timeZone);
    if (!Number.isFinite(startMs)) return null;
    // The end date is exclusive. One that is missing or backwards still gives
    // the single day it started on rather than a negative span.
    const stated = startOfLocalDayMs(event.end, timeZone);
    const endMs = Number.isFinite(stated) && stated > startMs
      ? stated
      : startOfLocalDayMs(addDays(event.start, 1), timeZone);
    return { startMs, endMs };
  }
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * Committed hours by calendar inside a window, largest first.
 *
 * The home calendar counts zero unless a pulse claimed the event: it is the
 * household's calendar, and an hour on it is only the owner's once they say
 * so. Claims are read by event id — the id the coder was handed and answered
 * with — never by matching an event's title to a pulse's words.
 */
export function neededByCalendar(
  mirror: CalendarMirror | null,
  window: LedgerWindow,
  timeZone: string,
  claimed: ReadonlySet<string>
): CalendarHours[] {
  const totals = new Map<string, CalendarHours>();
  for (const event of mirror?.events ?? []) {
    const range = eventRange(event, timeZone);
    if (range === null) continue;
    const ms = overlapMs(range.startMs, range.endMs, window);
    if (ms <= 0) continue;

    const entry = totals.get(event.calendar)
      ?? { calendar: event.calendar, hours: 0, allDay: 0, unclaimed: 0 };
    if (event.allDay) {
      entry.allDay += 1;
    } else if (event.calendar === HOME_CALENDAR && !claimed.has(event.id)) {
      entry.unclaimed += ms / MS_PER_HOUR;
    } else {
      entry.hours += ms / MS_PER_HOUR;
    }
    totals.set(event.calendar, entry);
  }
  return [...totals.values()].sort((a, b) => {
    if (a.hours !== b.hours) return b.hours - a.hours;
    return compareCodeUnits(a.calendar, b.calendar);
  });
}

/**
 * Needed and Spent side by side, paired only where the two names are the
 * same word.
 *
 * `db ↔ db` is the clean mapping the plan names, and equality between two
 * machine-configured identifiers is the whole of the rule — no stemming, no
 * synonyms, no "close enough". Everything unpaired stays in its own list and
 * is drawn beside the other rather than against it: `home` hours and `self`
 * hours are not two readings of one quantity, and a chart that subtracts them
 * would be inventing a number.
 */
export type NeededVsSpent = {
  paired: Array<{ name: string; needed: number; spent: number }>;
  neededOnly: CalendarHours[];
  spentOnly: DomainHours[];
};

export function pairNeededSpent(needed: readonly CalendarHours[], spent: readonly DomainHours[]): NeededVsSpent {
  const spentByName = new Map(spent.filter(bar => bar.domain !== null).map(bar => [bar.domain as string, bar]));
  const paired: NeededVsSpent['paired'] = [];
  const neededOnly: CalendarHours[] = [];
  for (const calendar of needed) {
    const match = spentByName.get(calendar.calendar);
    if (match === undefined) {
      neededOnly.push(calendar);
      continue;
    }
    paired.push({ name: calendar.calendar, needed: calendar.hours, spent: match.hours });
  }
  const pairedNames = new Set(paired.map(pair => pair.name));
  const spentOnly = spent.filter(bar => bar.domain === null || !pairedNames.has(bar.domain));
  return { paired, neededOnly, spentOnly };
}

// ============================================================================
// Timing — when an activity actually happens
// ============================================================================

/** One activity's 24 buckets of local start-hour, over the trailing window. */
export type ActivityTiming = {
  activity: string;
  /** 24 counts, index = local hour. */
  hours: number[];
  total: number;
};

/** Every row the window holds, and how many of them the strip has room to draw. */
export type ActivityTimingResult = { rows: ActivityTiming[]; hidden: number };

/**
 * When each activity actually happens.
 *
 * This is phase 3's habit-timing strip, rebuilt on the one thing the coder
 * still knows after phase 4. The old one counted `links.habitId`, which fence 9
 * retired along with the coder's view of habits; the label the coder writes
 * into `activity` needs no habit, no alias map, and no vocabulary read, and it
 * answers the same question — "when do I actually go to the gym" — for
 * anything the owner talks about, not only for things they made a habit of.
 *
 * Counted over `span.start`, which is the moment the activity BEGAN, not the
 * moment the line was typed. A block back-dated by the coder ("gym this
 * morning", said at noon) lands in the morning where it belongs.
 *
 * Only `SPENT_SIGNALS` — the same set the bars above are drawn from, so the two
 * instruments cannot disagree about what counted. A `note` mentioning the gym
 * is not the gym happening, and `state`/`plan` are not either. That is one line
 * to widen if a gate says so.
 *
 * A row appears only where something was logged. The habit strip drew empty
 * rows on purpose — a fixed set of habits the owner had configured, where "you
 * have never logged this" was itself the answer. Activities are an open set
 * with no such roster: a row for every label the vocabulary happens to hold
 * would be a list of words, not an answer.
 */
export function activityTiming(
  pulses: readonly PulseRow[],
  window: LedgerWindow,
  timeZone: string
): ActivityTimingResult {
  const rows = new Map<string, ActivityTiming>();

  for (const pulse of pulses) {
    if (pulse.signal === undefined) continue;
    if (!SPENT_SIGNALS.includes(pulse.signal)) continue;
    const activity = pulse.activity ?? null;
    if (activity === null || activity.length === 0) continue;
    const startMs = Date.parse(pulse.span?.start ?? '');
    if (!Number.isFinite(startMs)) continue;
    if (startMs < window.startMs || startMs > window.endMs) continue;

    const row = rows.get(activity) ?? { activity, hours: new Array<number>(24).fill(0), total: 0 };
    row.hours[localHour(startMs, timeZone)] += 1;
    row.total += 1;
    rows.set(activity, row);
  }

  const ordered = [...rows.values()].sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    // Plain code-unit comparison, never locale-aware: two devices showing the
    // same twelve weeks must order the rows the same way.
    return compareCodeUnits(a.activity, b.activity);
  });

  return { rows: ordered.slice(0, TIMING_ROWS), hidden: Math.max(0, ordered.length - TIMING_ROWS) };
}

// ============================================================================
// The honesty line
// ============================================================================

/** What the week's arithmetic left out, and why. Zero means the line is not drawn. */
export type LedgerHonesty = { uncoded: number; captured: number };

/**
 * The pulses captured in the window that the coder never reached.
 *
 * By `at` — the moment it was said — not by `span.start`, which an uncoded
 * pulse does not have. `signal === undefined` is the one total test for
 * uncoded, as `entities.ts` says: enrichment arrives all at once or not at
 * all, and no in-flight marker exists to confuse it with.
 */
export function ledgerHonesty(pulses: readonly PulseRow[], window: LedgerWindow): LedgerHonesty {
  let uncoded = 0;
  let captured = 0;
  for (const pulse of pulses) {
    const at = Date.parse(pulse.at);
    if (!Number.isFinite(at) || at < window.startMs || at > window.endMs) continue;
    captured += 1;
    if (pulse.signal === undefined) uncoded += 1;
  }
  return { uncoded, captured };
}

// ============================================================================
// Nutrition (phase 5)
// ============================================================================

/**
 * One day's eating, added up. Arithmetic and nothing else — no target
 * comparison, no verdict, no word about any of it (fence 6). The target, when
 * the owner has set one, is printed beside these numbers by the view; nothing
 * here knows it exists.
 */
export type DayNutrition = {
  /** Every counted calorie, stated and estimated together — the headline number. */
  kcal: number;
  /** How much of `kcal` came from a coder estimate rather than the owner's own figure. */
  estimatedKcal: number;
  /** Pulses the coder recognised as consumption and could not put a number on. */
  uncounted: number;
  /** One best-effort total. Sources are stored per pulse but not surfaced in v1. */
  proteinG: number;
  /**
   * Part of this day's total is a figure the owner stated rather than a sum —
   * everything up to the waterline they set. `estimatedKcal` and `uncounted`
   * still describe the rest honestly, so no surface needs to suppress them on
   * the strength of this flag; it says where the number came from, not that
   * the provenance beside it is wrong.
   */
  corrected: boolean;
};

const NO_NUTRITION = { kcal: 0, estimatedKcal: 0, uncounted: 0, proteinG: 0 };

/**
 * Sum one local day's nutrition.
 *
 * Two things are added up here: what the owner SAID this day came to
 * (`corrections`), and the items they logged on it. Items bucket by
 * `span.start` — the day the food was eaten, not the day it was mentioned;
 * see `eatenOn`.
 *
 * **A correction is a waterline, not a lid.** It is the owner reading their
 * ledger and saying what the day came to *as of that moment* — so it subsumes
 * everything eaten up to the instant they said it, and everything eaten after
 * it is added on top. Read as a lid it silently swallowed the rest of the day:
 * *"saturday's 880 is right"* at 14:00 made every meal that followed invisible,
 * with nothing on screen to say why (measured on real data, 2026-08-29).
 *
 * One rule covers both kinds of correction, which is why there is only one.
 * A finished day — *"friday was 2400"*, said on Saturday — has nothing eaten
 * after the waterline, so the sum is the owner's number and nothing else. A
 * day still being lived keeps accruing. Nothing here has to know which is which,
 * and nothing has to ask the coder to tell them apart.
 *
 * `kcal: null` is the uncounted case and adds nothing to the total — the
 * count of them is returned instead, so a day that dropped two meals reads as
 * a day that dropped two meals rather than as a light one. A pulse with no
 * `nutrition` at all contributes nothing anywhere: it is not food, and it is
 * not an omission either.
 */
export function dayNutrition(
  pulses: readonly PulseRow[],
  day: string,
  timeZone: string
): DayNutrition {
  const onDay = pulses.filter((pulse) => eatenOn(pulse, timeZone) === day);
  const items = sumNutrition(onDay);

  const correction = newestCorrectionFor(pulses, day);
  if (correction === null) return { ...items, corrected: false };

  // Strictly after: an item eaten at the very instant of the utterance is
  // inside the total it states. "had a burrito, 620 — so today's 1500 so far"
  // is one breath, and the owner counted the burrito before saying 1500.
  //
  // An unreadable `at` leaves nothing after the waterline, which is the safe
  // reading: the correction stands alone rather than double-counting the day.
  // Nothing in the app writes one — the coder refuses to code such a pulse.
  const after = sumNutrition(onDay.filter((pulse) => eatenAt(pulse) > correction.saidAtMs));

  return {
    // What they said, plus what they have eaten since saying it.
    kcal: correction.kcal + after.kcal,
    // Provenance describes only the part still being arrived at by arithmetic.
    // There is no estimated share of a figure the owner stated, and a meal
    // nobody could size from before the waterline is subsumed by it — that is
    // what stating a day's total means. Both can be non-zero again the moment
    // something is eaten after it, and then they are telling the truth.
    estimatedKcal: after.estimatedKcal,
    uncounted: after.uncounted,
    // Protein is corrected only when the correction says so. "friday was 2400"
    // is a claim about calories and says nothing about protein, so the whole
    // item sum stands — throwing it away would silently zero a number the
    // owner never disputed. When they DID state one, it is a waterline too.
    proteinG: correction.proteinG === undefined ? items.proteinG : correction.proteinG + after.proteinG,
    corrected: true,
  };
}

/**
 * The local day a pulse's food belongs to: when it was EATEN, not when it was
 * said.
 *
 * `span.start` and not `at`, which is the rest of this file's rule already
 * (`activityTiming` counts by `span.start` for the same reason) and was this
 * selector's own bug until 2026-08-29. The coder back-dates a span when the
 * owner says so, and a supper logged the next morning belongs to the night it
 * was eaten — bucketing it by capture time puts it permanently on the wrong
 * day, and no correction can move it because it is not the day that is wrong.
 *
 * The stream still reads by `at`, which is right for the stream: it shows what
 * was SAID today. The two questions are different and the answers may differ.
 *
 * `at` is the fallback for an uncoded pulse, which has no span — and for a
 * span whose start cannot be read, which nothing in the app writes.
 */
function eatenOn(pulse: PulseRow, timeZone: string): string | null {
  const at = eatenAt(pulse);
  return Number.isFinite(at) ? dayKey(at, timeZone) : null;
}

/**
 * The instant the food happened, which is the day rule above before it is
 * reduced to a date — `NaN` when neither the span nor `at` can be read.
 *
 * A day key alone cannot answer whether a meal came before or after a
 * waterline said at 14:00 on that same day, so the two callers share this and
 * the ordering can never disagree with the bucketing.
 */
function eatenAt(pulse: PulseRow): number {
  const spanStart = pulse.span === undefined ? NaN : Date.parse(pulse.span.start);
  return Number.isFinite(spanStart) ? spanStart : Date.parse(pulse.at);
}

/**
 * A standing correction and the instant it was said — its waterline.
 *
 * `saidAtMs` is capture time (`at`), deliberately, and it is the one place in
 * this file that is not `span.start`. A correction is not a thing that
 * happened at a time; it is an assertion made at a time, and what it asserts
 * is "everything up to *now*". A back-dated span on the correcting pulse
 * would move the waterline into a past the owner was not talking about.
 */
type StandingCorrection = PulseCorrection & { saidAtMs: number };

/**
 * The last thing the owner said about this day's total, or null.
 *
 * Newest wins, by capture order — a second correction is the owner changing
 * their mind, and the one they said last is the one they meant. `at` is not a
 * total order on its own, so ties break on id exactly as the fold and the
 * stream do; two devices must agree on which correction stands.
 *
 * Undo is deleting the pulse: with its corrections gone the selector falls
 * back to the item sum, or to the correction before it. There is no separate
 * uncorrect gesture and there should not be one — the correction is a thing
 * the owner said, and unsaying it is deleting the line.
 *
 * A second correction moves the waterline as well as the number, which is why
 * "1500 so far" an hour after "880 so far" is not double counting: the items
 * between the two are subsumed by the later one, exactly as the items before
 * the first were.
 */
function newestCorrectionFor(pulses: readonly PulseRow[], day: string): StandingCorrection | null {
  let winner: PulseCorrection | null = null;
  let winningPulse: PulseRow | null = null;
  for (const pulse of pulses) {
    let found: PulseCorrection | null = null;
    // Last entry wins within one pulse, for the same reason the newest pulse
    // wins across them: a later assertion in the same utterance is the later one.
    for (const correction of pulse.corrections ?? []) {
      if (correction.date === day) found = correction;
    }
    if (found === null) continue;
    if (winningPulse === null || compareOldestFirst(winningPulse, pulse) < 0) {
      winner = found;
      winningPulse = pulse;
    }
  }
  return winner === null || winningPulse === null
    ? null
    : { ...winner, saidAtMs: Date.parse(winningPulse.at) };
}

/** The item sum over an already-chosen set of pulses. */
function sumNutrition(pulses: readonly PulseRow[]): Omit<DayNutrition, 'corrected'> {
  const total = { ...NO_NUTRITION };
  for (const pulse of pulses) {
    const nutrition = pulse.nutrition;
    if (nutrition === undefined) continue;
    if (nutrition.kcal === null) {
      total.uncounted += 1;
    } else {
      total.kcal += nutrition.kcal;
      if (nutrition.kcalSource === 'estimated') total.estimatedKcal += nutrition.kcal;
    }
    // Independent of kcal: a stated protein figure with no calorie figure is a
    // real thing to say, and so is a plate whose protein nobody guessed at.
    if (nutrition.proteinG !== undefined) total.proteinG += nutrition.proteinG;
  }
  return total;
}

/** One day's bar in the weekly chart. */
export type DayKcal = { date: string; kcal: number; estimatedKcal: number; corrected: boolean };

/** Seven bars and the week's uncounted tally, which is a footnote and not a bar. */
export type WeekNutrition = { days: DayKcal[]; uncounted: number };

/**
 * The week's seven daily kcal bars.
 *
 * Always seven, including the days with nothing on them: a blank Wednesday is
 * a fact the chart should show, and a chart that silently omits its empty
 * days is a chart whose shape lies about the week.
 *
 * The uncounted tally is the week's, summed once here rather than per bar —
 * it is a footnote under the chart, because a bar cannot draw a meal whose
 * size nobody knows without inventing one.
 */
export function weekNutrition(
  pulses: readonly PulseRow[],
  date: string,
  timeZone: string,
  weekStartsOn: 0 | 1 = 1
): WeekNutrition {
  let uncounted = 0;
  const days = getWeekDates(date, weekStartsOn).map((day) => {
    const total = dayNutrition(pulses, day, timeZone);
    uncounted += total.uncounted;
    return { date: day, kcal: total.kcal, estimatedKcal: total.estimatedKcal, corrected: total.corrected };
  });
  return { days, uncounted };
}

/**
 * A calorie figure as it is printed, everywhere it is printed.
 *
 * One definition because two surfaces show these numbers — the Today line and
 * the weekly bars — and a thousands separator that appeared on one and not
 * the other would read as two different quantities.
 *
 * The locale is pinned rather than taken from the device. Every other number
 * in this file is compared or summed, never rendered, so this is the only
 * place a locale could get in; pinning it keeps the same journal rendering
 * the same way on the phone and the laptop, and keeps a test from asserting
 * against whatever locale the machine running it happens to have.
 *
 * Rounded to whole calories. A tenth of a calorie is noise from an estimate
 * that was never that precise.
 */
export function kcalLabel(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
