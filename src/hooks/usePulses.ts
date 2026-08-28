/**
 * The Pulse page's window onto the pulses.
 *
 * Capture is the whole point, so capture is what this optimises for: the write
 * goes to the outbox and the line renders, with no network anywhere in the
 * path. A push happens later — on the debounce, on the next foreground — and
 * the line is already the owner's either way.
 *
 * It reads on mount, like `useReadState` and for the same reason: a mount is
 * when the answer can have changed. A pulse captured on the other device
 * therefore shows up on this one after a sync and a remount, not the instant
 * the pull lands. That is the cross-tab staleness the architecture already
 * documents, and it is survivable here because a pulse is only ever written by
 * the device its owner is holding.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PulseEffect, PulseRow } from '../lib/entities';
import { NO_CHIP_NAMES, pulsesForDay } from '../lib/pulse';
import type { PulseChipNames } from '../lib/pulse';
import { scheduleFlush } from '../lib/sync';
import {
  applyPulseEffect,
  approvePulseVocabProposal,
  codeCapturedPulse,
  codeUncodedPulses,
  createPulse,
  deletePulse,
  dismissPulseEffect,
  dismissPulseVocabProposal,
  getHabits,
  getPulses,
  getTowerItems,
} from '../services/data';

export interface Pulses {
  /** The day's pulses, oldest first — the page reads downward into the box. */
  today: PulseRow[];
  /** What the chips call the habits and tasks the codings name, resolved by id. */
  names: PulseChipNames;
  /** Capture one. Resolves false when nothing was saved, so the box can keep the text. */
  capture: (text: string) => Promise<boolean>;
  remove: (id: string) => void;
  /**
   * Apply that proposal on that pulse, and drop its chip.
   *
   * The effect itself, never its position: an apply shifts the rest of the
   * list down, so a second tap landing before the repaint — or after a repaint
   * that never came — would name a different proposal (see `applyPulseEffect`).
   */
  applyEffect: (pulseId: string, effect: PulseEffect) => void;
  /** Drop the chip and keep the coding. Carried by value, for the same reason. */
  dismissEffect: (pulseId: string, effect: PulseEffect) => void;
  /** Approve the vocabulary proposal. Always a tap — it has no auto path. */
  applyVocab: (pulseId: string) => void;
  dismissVocab: (pulseId: string) => void;
}

export function usePulses(day: string, timeZone: string): Pulses {
  const [rows, setRows] = useState<PulseRow[]>([]);
  const [names, setNames] = useState<PulseChipNames>(NO_CHIP_NAMES);

  // Nothing may be set after the view closes: a capture is a write to
  // IndexedDB and its answer outlives whatever the owner typed it into.
  const live = useRef(true);
  // Ends the backlog sweep when the page it was opened for is gone, so a
  // glance at Pulse cannot leave a queue of paid calls running behind the app.
  const sweeper = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    sweeper.current = controller;
    return () => {
      live.current = false;
      controller.abort();
    };
  }, []);

  /**
   * Re-read the store into the list, without losing a line captured while the
   * read was in flight.
   *
   * The store is the answer for every pulse it knows about — a coding that
   * landed, a delete that stuck. But a capture that resolved after this read
   * started is only in `previous`, and replacing the list wholesale would take
   * it off the screen until something else refreshed. "Your line disappeared"
   * is the one failure capture must not have.
   *
   * The chip names come along with it. They are two more local reads of state
   * already folded, and a `spawnTask` that just landed has to be able to name
   * the task it created the moment the row repaints. Archived habits and done
   * tasks are included: a chip must still be able to say what it acted on.
   */
  const refresh = useCallback(async () => {
    const [stored, habits, towerItems] = await Promise.all([
      getPulses(),
      getHabits(true),
      getTowerItems(true),
    ]);
    if (!live.current) return;
    setNames({
      habits: Object.fromEntries(habits.map((habit) => [habit.id, habit.label])),
      towerItems: Object.fromEntries(towerItems.map((item) => [item.id, item.text])),
    });
    setRows((previous) => {
      const known = new Set(stored.map((row) => row.id));
      const missed = previous.filter((row) => !known.has(row.id));
      return missed.length === 0 ? stored : [...stored, ...missed];
    });
  }, []);

  /**
   * The backlog sweep, then a re-read so a pulse that just went from uncoded
   * to coded repaints. Never awaited by anything the owner is waiting on (O1).
   *
   * One at a time: a second sweep entered while the first is still walking the
   * backlog would re-read the same rows and race its own refresh, and the
   * data layer's per-pulse guard would make every call it managed to start a
   * no-op anyway.
   */
  const sweeping = useRef(false);
  const sweepThenRefresh = useCallback(async () => {
    if (sweeping.current) return;
    sweeping.current = true;
    try {
      await codeUncodedPulses(sweeper.current?.signal);
      await refresh();
    } catch (error) {
      // The rows already on screen stay as they are; the next successful
      // read (another save, another open) catches up.
      if (import.meta.env.DEV) console.error('Failed to refresh pulses after coding:', error);
    } finally {
      sweeping.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (error) {
        // A store that cannot be read is an empty stream, which is what an
        // owner with nothing captured today sees anyway.
        if (import.meta.env.DEV) console.error('Failed to read pulses:', error);
      }
      // "Uncoded pulses are coded on next open" — this is the open, and the
      // only place the backlog is walked. Off the render path already: the
      // initial read above has already settled.
      void sweepThenRefresh();
    })();
  }, [refresh, sweepThenRefresh]);

  const capture = useCallback(async (text: string): Promise<boolean> => {
    // An empty Enter is a no-op, not an empty pulse.
    if (text.trim().length === 0) return false;

    // Only the durable write is inside the try, and only its failure answers
    // false. Anything after it throwing would report a write that HAS landed
    // as lost, and the caller hands the text back: a second Enter then makes
    // a duplicate pulse, for one thing the owner said once.
    let saved: PulseRow;
    try {
      saved = await createPulse(text);
    } catch (error) {
      // The line is in no journal and never will be. Saying so is the caller's
      // job — it still has the text, and handing it back is the only way the
      // utterance is not simply lost.
      if (import.meta.env.DEV) console.error('Failed to capture a pulse:', error);
      return false;
    }

    // An edit that never reaches the journal is an edit the other device
    // never sees. The debounce inside collapses a burst into one push.
    scheduleFlush();
    if (live.current) setRows((previous) => [...previous, saved]);
    // "Coding runs on-save when online" — this line, not the whole history.
    // Fired, not awaited: capture has already resolved by the time this
    // settles, network dead or not (O1). It is not tied to the mount the way
    // the sweep is: this is one call, for the line the owner just typed, and
    // navigating away the same second should not throw its answer away.
    void (async () => {
      try {
        await codeCapturedPulse(saved.id);
        await refresh();
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to refresh pulses after coding:', error);
      }
    })();
    return true;
  }, [refresh]);

  const remove = useCallback((id: string) => {
    // Optimistic, and put back on a throw. The delete either happened or it
    // did not; a line that reappears is the honest report of the second.
    setRows((previous) => previous.filter((row) => row.id !== id));
    void (async () => {
      // Only the durable write is inside the try: anything after it throwing
      // would report a delete that HAS landed as failed, and this catch's
      // recovery — restoring the row from the store — would run for a store
      // that no longer has it.
      try {
        await deletePulse(id);
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to delete a pulse:', error);
        // Re-read rather than put a remembered copy back. The write failed, so
        // the store still holds the pulse, and the store is the answer — a copy
        // kept in a closure would also have to be kept correct.
        try {
          await refresh();
        } catch (reread) {
          if (import.meta.env.DEV) console.error('Failed to re-read pulses:', reread);
        }
        return;
      }
      // Same push path as every other write; the debounce collapses a burst.
      scheduleFlush();
    })();
  }, [refresh]);

  /**
   * Act on a chip, then re-read.
   *
   * Not optimistic, unlike `remove`. A tap here is a write to two entities at
   * once and the answer is whatever the fold says afterwards — showing the
   * chip gone before the commit resolved would mean showing a task spawned
   * that was not. The tap is a local IndexedDB write, so the wait is a frame.
   */
  const act = useCallback((work: () => Promise<void>) => {
    void (async () => {
      // Only work() answers for this catch. scheduleFlush cannot fail in
      // practice, but folding it into the same try would let its failure be
      // reported as "the act failed" — the catch's actual story, "nothing
      // happened", would be false for a write that landed.
      let acted = false;
      try {
        await work();
        acted = true;
      } catch (error) {
        // The chip is still there and still tappable, which is the honest
        // report: nothing happened.
        if (import.meta.env.DEV) console.error('Failed to act on a pulse proposal:', error);
      }
      // Same push path as every other write; the debounce collapses a burst.
      if (acted) scheduleFlush();
      try {
        await refresh();
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to re-read pulses:', error);
      }
    })();
  }, [refresh]);

  const applyEffect = useCallback(
    (pulseId: string, effect: PulseEffect) => act(() => applyPulseEffect(pulseId, effect)),
    [act]
  );
  const dismissEffect = useCallback(
    (pulseId: string, effect: PulseEffect) => act(() => dismissPulseEffect(pulseId, effect)),
    [act]
  );
  const applyVocab = useCallback((pulseId: string) => act(() => approvePulseVocabProposal(pulseId)), [act]);
  const dismissVocab = useCallback((pulseId: string) => act(() => dismissPulseVocabProposal(pulseId)), [act]);

  const today = useMemo(() => pulsesForDay(rows, day, timeZone), [rows, day, timeZone]);

  return { today, names, capture, remove, applyEffect, dismissEffect, applyVocab, dismissVocab };
}
