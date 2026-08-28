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

import type { PulseRow } from '../lib/entities';
import { pulsesForDay } from '../lib/pulse';
import { scheduleFlush } from '../lib/sync';
import { codeUncodedPulses, createPulse, deletePulse, getPulses } from '../services/data';

export interface Pulses {
  /** The day's pulses, oldest first — the page reads downward into the box. */
  today: PulseRow[];
  /** Capture one. Resolves false when nothing was saved, so the box can keep the text. */
  capture: (text: string) => Promise<boolean>;
  remove: (id: string) => void;
}

export function usePulses(day: string, timeZone: string): Pulses {
  const [rows, setRows] = useState<PulseRow[]>([]);

  // Nothing may be set after the view closes: a capture is a write to
  // IndexedDB and its answer outlives whatever the owner typed it into.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /**
   * Runs the lazy coding queue, then re-reads so a pulse that just went from
   * uncoded to coded repaints. Never awaited by anything the owner is
   * waiting on (O1) — both call sites below fire this and move on.
   */
  const codeThenRefresh = useCallback(async () => {
    await codeUncodedPulses();
    if (!live.current) return;
    try {
      setRows(await getPulses());
    } catch (error) {
      // The rows already on screen stay as they are; the next successful
      // read (another save, another open) catches up.
      if (import.meta.env.DEV) console.error('Failed to refresh pulses after coding:', error);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await getPulses();
        if (live.current) setRows(stored);
      } catch (error) {
        // A store that cannot be read is an empty stream, which is what an
        // owner with nothing captured today sees anyway.
        if (import.meta.env.DEV) console.error('Failed to read pulses:', error);
      }
      // "Uncoded pulses are coded on next open" — this is the open. Off the
      // render path already: the initial read above has already settled.
      void codeThenRefresh();
    })();
  }, [codeThenRefresh]);

  const capture = useCallback(async (text: string): Promise<boolean> => {
    // An empty Enter is a no-op, not an empty pulse.
    if (text.trim().length === 0) return false;
    try {
      const saved = await createPulse(text);
      // An edit that never reaches the journal is an edit the other device
      // never sees. The debounce inside collapses a burst into one push.
      scheduleFlush();
      if (live.current) setRows((previous) => [...previous, saved]);
      // "Coding runs on-save when online." Fired, not awaited: capture has
      // already resolved by the time this settles, network dead or not (O1).
      void codeThenRefresh();
      return true;
    } catch (error) {
      // The line is in no journal and never will be. Saying so is the caller's
      // job — it still has the text, and handing it back is the only way the
      // utterance is not simply lost.
      if (import.meta.env.DEV) console.error('Failed to capture a pulse:', error);
      return false;
    }
  }, [codeThenRefresh]);

  const remove = useCallback((id: string) => {
    // Optimistic, and put back on a throw. The delete either happened or it
    // did not; a line that reappears is the honest report of the second.
    setRows((previous) => previous.filter((row) => row.id !== id));
    void (async () => {
      try {
        await deletePulse(id);
        scheduleFlush();
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to delete a pulse:', error);
        // Re-read rather than put a remembered copy back. The write failed, so
        // the store still holds the pulse, and the store is the answer — a copy
        // kept in a closure would also have to be kept correct.
        try {
          const stored = await getPulses();
          if (live.current) setRows(stored);
        } catch (reread) {
          if (import.meta.env.DEV) console.error('Failed to re-read pulses:', reread);
        }
      }
    })();
  }, []);

  const today = useMemo(() => pulsesForDay(rows, day, timeZone), [rows, day, timeZone]);

  return { today, capture, remove };
}
