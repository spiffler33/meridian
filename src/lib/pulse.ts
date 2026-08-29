/**
 * The stream, as a rule rather than a screen.
 *
 * A pulse is one captured utterance and its instant. Everything the stream
 * needs to decide is here: which pulses belong to a day, and in what order
 * they read. Pure — no IndexedDB, no fetch, no React.
 *
 * The day is a LOCAL day. `at` is an ISO instant, so slicing its first ten
 * characters would bucket by UTC, and an evening pulse west of Greenwich would
 * land on tomorrow's stream. `dayKey` is the same zone-aware bucketing the
 * calendar mirror already uses, for the same reason.
 */

import { dayKey } from './calendar';
import type { PulseEffect, PulseRow, PulseVocabProposal } from './entities';

/**
 * Oldest first — the day reads downward and the newest line ends up next to
 * the capture box, which sits at the foot of the page.
 *
 * It was newest-first for exactly one day. Gate 1 answered the question the
 * plan asked: with the box at the bottom, the reverse order puts the last
 * thing said furthest from where the next thing is typed.
 *
 * `at` alone is not a total order — a restore, or two devices, can put two
 * pulses on one millisecond — and an order decided by array position would
 * differ between devices showing the same day. The id is the same final
 * tiebreak the fold uses, and plain code-unit comparison for the same reason:
 * never locale-aware.
 */
export function compareOldestFirst(a: PulseRow, b: PulseRow): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * The pulses captured on one local day, oldest first.
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
  return onDay.sort(compareOldestFirst);
}

// ============================================================================
// Chips: what a proposal says, and what it would write
// ============================================================================

/**
 * One value off an effect's payload, or null.
 *
 * An effect is `{ type }` plus whatever that type carries (`PulseEffect`), so
 * every read of it is a shape check. Blank is the same as absent: an empty
 * `eventId` names nothing, and neither the chip nor the write it stands for
 * has anything to do with it.
 */
export function effectString(effect: PulseEffect, key: string): string | null {
  const value = effect[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * One effect's identity: exactly what it proposes.
 *
 * An effect carries no id — it is a proposal, not an entity — so the only
 * thing that tells one apart from another is its own payload. Its stored JSON
 * is that payload, so the serialization IS the identity: exact structural
 * equality over a machine-defined record, never a pattern match over what it
 * says. Both sides of any comparison come out of the same stored line, so key
 * order is the same on both.
 *
 * Two effects proposing exactly the same thing are the same proposal, and
 * applying either one is the same act — which is what makes this safe to use
 * where a position would otherwise be trusted (a list shifts under an apply)
 * and as a React key (an index does not survive a removal).
 */
export function effectKey(effect: PulseEffect): string {
  return JSON.stringify(effect);
}

/**
 * The words on one effect chip.
 *
 * The chip is the verb; the pulse line above it is the object, so the label
 * says what would happen and names only what the line cannot. One effect type
 * survives phase 4, and the switch stays a switch so that adding a second
 * without giving it words is a compile error rather than a blank chip.
 *
 * It no longer takes the pulse or a name table: the retired effects were the
 * ones that named a habit or a tower item, and resolving those ids is exactly
 * the reading fence 9 forbids.
 */
export function effectChipLabel(effect: PulseEffect): string {
  switch (effect.type) {
    case 'claimEvent':
      return 'claim event';
  }
}

/** The words on the vocabulary chip. */
export function vocabChipLabel(proposal: PulseVocabProposal): string {
  switch (proposal.kind) {
    case 'domain':
      return `+ domain ${proposal.value}`;
    case 'activity':
      return proposal.mapsTo === null
        ? `+ activity ${proposal.value}`
        : `+ activity ${proposal.value} → ${proposal.mapsTo}`;
    case 'person':
      return `+ person ${proposal.value}`;
  }
}
