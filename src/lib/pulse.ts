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
 * `habitId` names nothing, and neither the chip nor the write it stands for
 * has anything to do with it.
 */
export function effectString(effect: PulseEffect, key: string): string | null {
  const value = effect[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The text a `spawnTask` chip would create the Tower item with: the coder's
 * own proposal, or — when it offered none — the line the owner actually said.
 *
 * The fallback is the same one the deleted `parseTowerInput` stub made: a
 * captured line IS the task, verbatim. It is not a rewrite of the pulse
 * (fence 1 guards the pulse's own `text` field, which nothing here touches).
 */
export function spawnTaskText(pulse: PulseRow, effect: PulseEffect): string {
  return effectString(effect, 'text') ?? pulse.text.trim();
}

/**
 * What the chips call things, resolved BY ID.
 *
 * The coder is handed `todayHabits[].id` and `openTowerItems[].id` and answers
 * with those ids; the names come back out of the store the same way. Nothing
 * here ever matches a proposal to a habit or a task by its text — that is the
 * heuristic fence 2 exists to forbid, and it would be a silent miscoding
 * rather than a visible failure.
 */
export type PulseChipNames = {
  /** habit id -> label. */
  habits: Readonly<Record<string, string>>;
  /** tower item id -> text. */
  towerItems: Readonly<Record<string, string>>;
};

export const NO_CHIP_NAMES: PulseChipNames = { habits: {}, towerItems: {} };

/** What an `updateTask` chip proposes to change, in the order Tower shows it. */
function updateTaskChanges(effect: PulseEffect): string[] {
  const changes: string[] = [];
  const status = effectString(effect, 'status');
  if (status !== null) changes.push(status);
  const waitingOn = effectString(effect, 'waitingOn');
  if (waitingOn !== null) changes.push(`waiting on ${waitingOn}`);
  const expectsBy = effectString(effect, 'expectsBy');
  if (expectsBy !== null) changes.push(`by ${expectsBy}`);
  return changes;
}

/**
 * The words on one effect chip.
 *
 * The chip is the verb; the pulse line above it is the object, so the label
 * says what would happen and names only what the line cannot. A target the
 * store no longer knows falls back to the bare noun rather than to an id —
 * the owner cannot act on a uuid, and the tap is safe either way (an effect
 * naming nothing writes nothing).
 */
export function effectChipLabel(pulse: PulseRow, effect: PulseEffect, names: PulseChipNames): string {
  switch (effect.type) {
    case 'completeHabit': {
      const habitId = effectString(effect, 'habitId');
      return `tick ${(habitId === null ? undefined : names.habits[habitId]) ?? 'habit'}`;
    }
    case 'spawnTask': {
      const text = spawnTaskText(pulse, effect);
      return text.length === 0 ? '+ task' : `+ ${text}`;
    }
    case 'updateTask': {
      const towerId = effectString(effect, 'towerId');
      const item = (towerId === null ? undefined : names.towerItems[towerId]) ?? 'task';
      const changes = updateTaskChanges(effect);
      return changes.length === 0 ? item : `${item} → ${changes.join(', ')}`;
    }
    case 'claimEvent':
      return 'claim event';
  }
}

/** The words on the vocabulary chip. `mapsTo` is an id only for a habit alias. */
export function vocabChipLabel(proposal: PulseVocabProposal, names: PulseChipNames): string {
  switch (proposal.kind) {
    case 'domain':
      return `+ domain ${proposal.value}`;
    case 'activity':
      return proposal.mapsTo === null
        ? `+ activity ${proposal.value}`
        : `+ activity ${proposal.value} → ${proposal.mapsTo}`;
    case 'person':
      return `+ person ${proposal.value}`;
    case 'habitAlias': {
      const habit = proposal.mapsTo === null ? undefined : names.habits[proposal.mapsTo];
      return `+ alias ${proposal.value} → ${habit ?? 'habit'}`;
    }
  }
}
