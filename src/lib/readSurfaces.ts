/**
 * The tape's arithmetic, away from its drawing.
 *
 * Nothing here touches React or the DOM: eight weeks of a theme as eight
 * characters, how many weeks it has run, the tone its state is drawn in, and a
 * delta that carries its own sign. The pane draws; this decides what there is
 * to draw.
 */

/** Eight levels of block, index 0 being alive but untouched. */
const SPARK_BLOCKS = '▁▂▃▄▅▆▇█';

/** A week before the theme existed. Not a zero — there was nothing to count. */
const SPARK_UNBORN = '·';

/**
 * Eight weeks of a theme, as eight characters.
 *
 * The tape is a trend instrument and this is the trend: one block per week,
 * scaled against the theme's own busiest week rather than the tape's, so a
 * quiet theme still shows its own shape. The published edition draws exactly
 * this, so the two readings of one tape agree.
 *
 * A week before `first_seen` is a middle dot, not a low block: the theme did
 * not exist, which is a different fact from a week in which nothing touched it.
 *
 * Ties round up here and to even in the edition's Python, so one week in a
 * hundred can sit one block apart between the two. Blocks, not numbers.
 */
export function sparkline(
  touches: readonly number[],
  weeks: readonly string[],
  firstSeen: string | undefined
): string {
  let busiest = 0;
  for (const count of touches) if (count > busiest) busiest = count;

  let out = '';
  for (let index = 0; index < touches.length; index += 1) {
    const week = weeks[index];
    if (firstSeen !== undefined && week !== undefined && week < firstSeen.slice(0, 10)) {
      out += SPARK_UNBORN;
      continue;
    }
    const count = touches[index];
    if (!Number.isFinite(count) || count <= 0) {
      out += SPARK_BLOCKS[0];
      continue;
    }
    const level = busiest > 0 ? Math.max(1, Math.min(7, Math.round((count / busiest) * 7))) : 1;
    out += SPARK_BLOCKS[level];
  }
  return out;
}

/** How many weeks a theme has been on the tape, counting the week it was cut. */
export function weeksSince(
  firstSeen: string | undefined,
  runDate: string | undefined
): number | null {
  if (firstSeen === undefined || runDate === undefined) return null;
  const born = Date.parse(`${firstSeen.slice(0, 10)}T00:00:00Z`);
  const cut = Date.parse(`${runDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born) || Number.isNaN(cut)) return null;
  return Math.max(0, Math.floor((cut - born) / 86_400_000 / 7) + 1);
}

const STATE_TONE: Record<string, string> = {
  HOT: 'text-accent',
  NEW: 'text-settled',
  BUILDING: 'text-cite',
  COOLING: 'text-text-muted',
};

export function stateTone(state: string | undefined): string {
  return (state && STATE_TONE[state]) ?? 'text-text-secondary';
}

export function signed(value: number | undefined): string | null {
  if (typeof value !== 'number' || value === 0) return null;
  return value > 0 ? `+${value}` : `${value}`;
}
