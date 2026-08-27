/**
 * The stream, as a rule rather than a screen.
 *
 * A pulse is one captured utterance and its instant. Everything the Today
 * stream needs to decide is here: which pulses belong to a day, and in what
 * order they read. Pure — no IndexedDB, no fetch, no React.
 *
 * The day is a LOCAL day. `at` is an ISO instant, so slicing its first ten
 * characters would bucket by UTC, and an evening pulse west of Greenwich would
 * land on tomorrow's stream. `dayKey` is the same zone-aware bucketing the
 * calendar mirror already uses, for the same reason.
 */

import { dayKey } from './calendar';
import type { PulseRow } from './entities';

/**
 * Newest first — the most recent utterance sits next to the capture box.
 *
 * Exactly the reverse of ascending order, tiebreak included: `at` alone is not
 * total (a restore, or two devices, can put two pulses on one millisecond) and
 * an order decided by array position would differ between devices showing the
 * same day. The id is the same final tiebreak the fold uses, and plain
 * code-unit comparison for the same reason — never locale-aware.
 */
export function compareNewestFirst(a: PulseRow, b: PulseRow): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/**
 * The pulses captured on one local day, newest first.
 *
 * A row whose `at` cannot be read as an instant is dropped rather than
 * rendered: it belongs to no day, and handing an unparseable date to
 * `Intl.DateTimeFormat` throws — which would take the whole view down over one
 * bad line. Nothing in the app writes such a row; a hand-edited journal can.
 */
export function pulsesForDay(
  rows: readonly PulseRow[],
  day: string,
  timeZone: string
): PulseRow[] {
  const onDay: PulseRow[] = [];
  for (const row of rows) {
    const at = Date.parse(row.at);
    if (!Number.isFinite(at)) continue;
    if (dayKey(at, timeZone) === day) onDay.push(row);
  }
  return onDay.sort(compareNewestFirst);
}
