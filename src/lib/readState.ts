/**
 * The reading backlog, as a rule rather than a screen.
 *
 * Two things decide whether an item is unread: the baseline, and whether the
 * owner has said so. Everything published before the pane existed was already
 * read — in email, where this corpus has always been delivered — so the
 * baseline is the mark that keeps day one from opening as three hundred
 * alarms. After it, an item is unread until it is explicitly marked.
 *
 * Only dated material can be in a backlog. Entries, the tape window and the
 * charts carry a date; the canon and the wiki do not, and they are references
 * rather than a queue — you do not fall behind on a wiki. They can still be
 * marked read, which is how the canon shows progress, but they never alarm.
 *
 * Pure: no IndexedDB, no fetch, no React. Slicing an ISO timestamp to its date
 * is reading a machine-defined format this app writes itself, not a heuristic
 * over prose.
 */

/** `YYYY-MM-DD` is the first ten characters of every ISO timestamp. */
const DATE_LENGTH = 10;

/** One thing that can be read, as the backlog rule sees it. */
export type ReadableItem = {
  /** `<surface>:<itemKey>` — the readItem entity id. */
  key: string;
  /** `YYYY-MM-DD`, or null for material that carries no date of its own. */
  date: string | null;
};

/**
 * The day the baseline falls on, or null when no baseline exists yet.
 *
 * Comparing a day to a day rather than a day to an instant is deliberate. An
 * item's date has no time in it, so an entry published on the baseline's own
 * day cannot be placed either side of the instant — and rounding it to "before"
 * would hide it forever, while rounding it to "after" costs one tap. The
 * baseline day itself therefore counts as unread.
 */
export function baselineDay(baseline: string | null): string | null {
  if (baseline === null || baseline.length < DATE_LENGTH) return null;
  return baseline.slice(0, DATE_LENGTH);
}

/**
 * Whether one item is part of the backlog.
 *
 * Undated material is never unread, and neither is anything the baseline
 * covers. ISO dates compare lexicographically, so this is a plain comparison.
 */
export function isUnread(item: ReadableItem, day: string | null, marked: ReadonlySet<string>): boolean {
  if (day === null) return false;
  if (item.date === null || item.date.length === 0) return false;
  if (item.date < day) return false;
  return !marked.has(item.key);
}

/**
 * How many of these are unread — or null when the answer is not known yet.
 *
 * Null is not zero. Before a baseline exists there is no backlog to report,
 * and an instrument that says "at setpoint" because it has not looked yet is
 * worse than one that admits it.
 */
export function countUnread(
  items: readonly ReadableItem[],
  day: string | null,
  marked: ReadonlySet<string>
): number | null {
  if (day === null) return null;
  let count = 0;
  for (const item of items) if (isUnread(item, day, marked)) count += 1;
  return count;
}

/** The days on which something was marked read. What the year heatmap asks for. */
export function readDaysOf(rows: readonly { read_at: string }[]): Set<string> {
  const days = new Set<string>();
  for (const row of rows) {
    if (row.read_at.length >= DATE_LENGTH) days.add(row.read_at.slice(0, DATE_LENGTH));
  }
  return days;
}
