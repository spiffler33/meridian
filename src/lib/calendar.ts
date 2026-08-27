/**
 * The calendar mirror: `events.json` as the day's real shape.
 *
 * `calendar-data`'s README owns this schema. A scheduled Action there fetches
 * the secret iCal feeds, expands recurrences, and commits the result; meridian
 * only ever reads it. Google Calendar stays the place events are created and
 * alarmed — this is a mirror, and the plan's first fence is that the app never
 * writes to that repo.
 *
 * Everything here is pure. The file arrives as text from the content cache and
 * leaves as buckets a view can paint, with no IndexedDB and no clock of its
 * own: `now` is always a parameter, because a day-shape strip that reads the
 * wall clock cannot be tested at 23:59.
 *
 * Two time models live side by side and must not be confused.
 *
 * A **timed** event carries UTC instants and belongs to whatever local day the
 * device is in — 09:30Z is one date in Singapore and another in Los Angeles.
 * An **all-day** event carries date strings and belongs to those dates
 * literally, in every timezone, because that is what an all-day event means.
 * Its end is EXCLUSIVE (RFC 5545): a one-day event ends on the following day.
 * Treating that end as inclusive puts a phantom second day on every all-day
 * event in the mirror.
 */

/** The one file meridian reads from the calendar mirror. */
export const EVENTS_PATH = 'events.json';

/**
 * The mirror's schedule is Singapore time and so is the staleness window.
 * A fixed offset, not a timezone lookup: Singapore has had no DST since 1935,
 * and the alternative is asking Intl a question whose answer never changes.
 */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The hours the Action runs (06:00–00:30 SGT). Outside them, silence is expected. */
const MIRROR_ACTIVE_FROM_HOUR = 6;

/**
 * How long a mirror may go unrefreshed during those hours before it is called
 * stale. The Action runs every 30 min; 90 allows two missed runs, so a single
 * skipped cron tick is not an alarm and a broken one is.
 */
export const STALE_AFTER_MS = 90 * 60 * 1000;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface CalendarEvent {
  id: string;
  calendar: string;
  title: string;
  /** UTC ISO instant for a timed event; a `YYYY-MM-DD` date for an all-day one. */
  start: string;
  /** Same, and for an all-day event this date is not included in the event. */
  end: string;
  allDay: boolean;
  location: string | null;
}

export interface CalendarMirror {
  /** When the Action last wrote the file, epoch ms. */
  generatedAt: number;
  /** The dates the mirror covers, as it reports them. */
  window: { start: string; end: string };
  /** The calendars it drew from, by name. */
  calendars: string[];
  events: CalendarEvent[];
}

export interface CalendarParse {
  /** Null when the file could not be read as a mirror at all. */
  mirror: CalendarMirror | null;
  /** Why, in one line, when it could not. Never any of the file's contents. */
  error: string | null;
  /**
   * Events dropped for missing or malformed fields. A number rather than a
   * silence: a mirror that quietly loses three of its events looks exactly
   * like a light week.
   */
  skipped: number;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * One event, or null if it is not one.
 *
 * A missing title is not repaired with a placeholder. The mirror's own
 * `PRIVATE_CALS` switch is what replaces titles, at source; inventing one here
 * would show an event that the calendar does not have.
 */
function readEvent(raw: unknown): CalendarEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const id = str(value.id);
  const calendar = str(value.calendar);
  const title = str(value.title);
  const start = str(value.start);
  const end = str(value.end);
  if (!id || !calendar || !title || !start || !end) return null;
  if (typeof value.allDay !== 'boolean') return null;
  return { id, calendar, title, start, end, allDay: value.allDay, location: str(value.location) };
}

/**
 * The mirror as the file describes it.
 *
 * Bad input never throws, for the same reason the journal fold does not: this
 * runs on the path that paints the day, and a parse error that escapes takes
 * the whole view with it. A file that is not JSON, or is JSON but not a
 * mirror, comes back as a reason Settings can show.
 */
export function parseCalendar(text: string): CalendarParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { mirror: null, error: 'the mirror file is not readable JSON', skipped: 0 };
  }
  if (typeof body !== 'object' || body === null) {
    return { mirror: null, error: 'the mirror file is not an object', skipped: 0 };
  }

  const value = body as Record<string, unknown>;
  const generatedAtText = str(value.generated_at);
  const generatedAt = generatedAtText === null ? NaN : Date.parse(generatedAtText);
  if (!Number.isFinite(generatedAt)) {
    return { mirror: null, error: 'the mirror file has no usable generated_at', skipped: 0 };
  }
  if (!Array.isArray(value.events)) {
    return { mirror: null, error: 'the mirror file carries no events list', skipped: 0 };
  }

  const events: CalendarEvent[] = [];
  let skipped = 0;
  for (const raw of value.events) {
    const event = readEvent(raw);
    if (event) events.push(event);
    else skipped += 1;
  }

  const window = (value.window ?? {}) as Record<string, unknown>;
  return {
    mirror: {
      generatedAt,
      window: { start: str(window.start) ?? '', end: str(window.end) ?? '' },
      calendars: Array.isArray(value.calendars) ? value.calendars.filter(isString) : [],
      events,
    },
    error: null,
    skipped,
  };
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * The local date an instant falls on, as `YYYY-MM-DD`.
 *
 * Read off `formatToParts` rather than a formatted string: the parts are
 * looked up by name, so no locale's date order or separator can change the
 * answer. A locale-shaped `format()` call here would put the month first for
 * an en-US device and silently bucket every event into the wrong day.
 */
export function dayKey(instantMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instantMs));
  const find = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${find('year')}-${find('month')}-${find('day')}`;
}

/** The next date after `date`, both `YYYY-MM-DD`. Dates only — no timezone involved. */
function nextDate(date: string): string {
  const at = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(at)) return date;
  return new Date(at + MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Every local date an event touches.
 *
 * An event that runs 23:00–01:00 belongs to both days it is visible on, and a
 * three-day all-day span belongs to all three: the day-shape strip is asking
 * "what is on this day", and an event that started yesterday is still on it.
 *
 * All-day dates are taken as written. Converting them through a timezone is
 * the classic bug — 2026-08-26 parsed as UTC midnight and rendered in Los
 * Angeles becomes the 25th, and a birthday moves a day west of Greenwich.
 */
export function daysTouched(event: CalendarEvent, timeZone: string): string[] {
  if (event.allDay) {
    const days: string[] = [];
    // The end date is exclusive, so the loop stops before it. An end at or
    // before the start still yields the start day rather than nothing.
    for (let day = event.start; day !== event.end && days.length < 400; day = nextDate(day)) {
      days.push(day);
    }
    return days.length > 0 ? days : [event.start];
  }

  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  if (!Number.isFinite(startMs)) return [];
  const first = dayKey(startMs, timeZone);
  if (!Number.isFinite(endMs) || endMs <= startMs) return [first];

  const days = [first];
  // Walk instants rather than dates: stepping a day at a time from the start
  // keeps this right across a DST change, where a local day is 23 or 25 hours.
  for (let at = startMs + MS_PER_DAY; at < endMs; at += MS_PER_DAY) {
    const key = dayKey(at, timeZone);
    if (key !== days[days.length - 1]) days.push(key);
  }
  // An event ending exactly at midnight belongs to the day before it, not to
  // the minute of the next one.
  const last = dayKey(endMs - 1, timeZone);
  if (last !== days[days.length - 1]) days.push(last);
  return days;
}

/**
 * Reading order within a day: all-day first, then timed by start.
 *
 * The final tiebreak is the id, for the same reason the journal fold's order
 * key ends with one — two events at the same minute must not swap places
 * between renders because the mirror listed them in a different order.
 */
function byDayOrder(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One local day's events, in reading order. */
export function eventsForDay(
  mirror: CalendarMirror | null,
  date: string,
  timeZone: string
): CalendarEvent[] {
  if (!mirror) return [];
  return mirror.events
    .filter(event => daysTouched(event, timeZone).includes(date))
    .sort(byDayOrder);
}

/**
 * Several days at once, keyed by date.
 *
 * One pass over the mirror rather than one per day: the week view asks for
 * seven, and every event would otherwise have its span recomputed seven times.
 * Days with nothing on them are present and empty, so a caller can render the
 * week without checking whether each key exists.
 */
export function eventsForDays(
  mirror: CalendarMirror | null,
  dates: readonly string[],
  timeZone: string
): Map<string, CalendarEvent[]> {
  const buckets = new Map<string, CalendarEvent[]>();
  for (const date of dates) buckets.set(date, []);
  if (!mirror) return buckets;

  for (const event of mirror.events) {
    for (const day of daysTouched(event, timeZone)) {
      buckets.get(day)?.push(event);
    }
  }
  for (const bucket of buckets.values()) bucket.sort(byDayOrder);
  return buckets;
}

/**
 * Whether the mirror has gone quiet while it was supposed to be running.
 *
 * The Action runs 06:00–00:30 SGT, so a mirror last written at 01:00 is not
 * stale at 05:00 — it is exactly as fresh as the schedule allows. Only inside
 * the running hours does age mean something is broken, and that is the only
 * time the owner is told anything.
 */
export function isMirrorStale(generatedAt: number | null, now: number): boolean {
  if (generatedAt === null || !Number.isFinite(generatedAt)) return false;
  // Modulo twice: the first can go negative for an instant before the epoch,
  // and a negative hour would read as "before 06:00" forever.
  const intoSgtDay = ((((now + SGT_OFFSET_MS) % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY);
  const sgtHour = Math.floor(intoSgtDay / MS_PER_HOUR);
  if (sgtHour < MIRROR_ACTIVE_FROM_HOUR) return false;
  return now - generatedAt > STALE_AFTER_MS;
}

/**
 * An event's clock time in the device's zone, as `HH:MM`.
 *
 * 24-hour, and `hourCycle: 'h23'` rather than `hour12: false` — the latter
 * renders midnight as 24:00 in several locales, so a day would open with an
 * hour that does not exist. Read off parts for the same reason `dayKey` is:
 * no locale may reorder or re-separate it.
 */
export function timeLabel(instant: string, timeZone: string): string {
  const at = Date.parse(instant);
  if (!Number.isFinite(at)) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(at));
  const find = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${find('hour')}:${find('minute')}`;
}

export interface DayRow {
  event: CalendarEvent;
  /** Over already. Only a day containing `now` has any of these. */
  past: boolean;
  /** The one to look at: happening now, or the next one to start. */
  next: boolean;
}

/**
 * A day's events marked for rendering: what is behind you, and what is next.
 *
 * "Next" is the first timed event that has not finished — so a meeting you are
 * sitting in is the one marked, not the one after it. That is the honest
 * answer to "what am I in the middle of", and it is what the strip is for.
 *
 * All-day events are never marked. They are the day's context, not the next
 * thing to do, and marking one would spend the single accent on a whole-day
 * fact that is already at the top of the list.
 *
 * The order in is the order out: `eventsForDay` already sorted it.
 */
export function dayShape(events: readonly CalendarEvent[], now: number): DayRow[] {
  const rows = events.map(event => ({
    event,
    // An event that ended exactly now is over. The alternative keeps a
    // finished meeting lit for the length of one render.
    past: !event.allDay && Date.parse(event.end) <= now,
    next: false,
  }));
  const upNext = rows.find(row => !row.event.allDay && !row.past);
  if (upNext) upNext.next = true;
  return rows;
}

/**
 * The zone this device is in, which is the only zone events are rendered in.
 *
 * Falls back to UTC rather than throwing: a device that cannot name its own
 * timezone should show the day slightly wrong, not show nothing.
 */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
