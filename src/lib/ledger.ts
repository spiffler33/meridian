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
import type { PulseRow, PulseSignal } from './entities';
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

const PARTS_CACHE = new Map<string, Intl.DateTimeFormat>();

/**
 * `Intl.DateTimeFormat` construction is the expensive part of every call
 * below, and a week's fold asks for hundreds. One formatter per zone, reused.
 */
function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  const cached = PARTS_CACHE.get(timeZone);
  if (cached) return cached;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  PARTS_CACHE.set(timeZone, format);
  return format;
}

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
  const find = (type: string) => Number(parts.find(part => part.type === type)?.value ?? '0');
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
    return a.pulse.id < b.pulse.id ? -1 : a.pulse.id > b.pulse.id ? 1 : 0;
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
  const left = a.domain ?? '';
  const right = b.domain ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
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
    return a.calendar < b.calendar ? -1 : a.calendar > b.calendar ? 1 : 0;
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
    return a.activity < b.activity ? -1 : a.activity > b.activity ? 1 : 0;
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
