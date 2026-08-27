/**
 * What has been read, and what the backlog therefore is.
 *
 * Read-state is journal data like everything else: a `readItem` per item the
 * owner has marked, folded from the same events every other device sees. This
 * hook is the views' window onto it — the marks, the baseline, and the two
 * writes that change them.
 *
 * It reads on mount rather than subscribing. The Read pane and the Year view
 * are never on screen at once, so a mount is exactly when the answer can have
 * changed; a marked item updates in place because this hook holds the set.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { baselineDay, countUnread, isSpent, readDaysOf, type ReadableItem } from '../lib/readState';
import { scheduleFlush } from '../lib/sync';
import {
  ensureReadingBaseline,
  getReadItems,
  getReadingBaseline,
  setItemRead,
} from '../services/data';

export interface ReadState {
  isRead: (key: string) => boolean;
  toggle: (key: string) => void;
  /** How many of these are unread, or null before a baseline exists. */
  unread: (items: readonly ReadableItem[]) => number | null;
  /** Whether this one has left the backlog, and can fold behind the reveal. */
  spent: (item: ReadableItem) => boolean;
  /** The days something was marked read on. What the year heatmap asks for. */
  days: Set<string>;
}

/**
 * @param synced whether the reading pane has completed a sync on this device.
 *   The baseline is established the first time that is true and never again;
 *   a caller that only reads — the Year view — leaves it false and writes
 *   nothing.
 */
export function useReadState(synced = false): ReadState {
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const [days, setDays] = useState<Set<string>>(() => new Set());
  const [baseline, setBaseline] = useState<string | null>(null);

  // Nothing may be set after the view closes: a mark is a write to IndexedDB
  // and the answer outlives whatever the owner tapped it on.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /**
   * The toggle that owns the current answer.
   *
   * Each toggle re-reads the store afterwards, to pick up the day the mark
   * landed on. Those reads can finish out of order — mark then unmark, and the
   * mark's read-back arrives last — and adopting a stale one would put the tick
   * straight back. Only the newest toggle's read is allowed to land.
   */
  const latest = useRef(0);

  const adopt = useCallback((rows: readonly { id: string; read_at: string }[]) => {
    setMarked(new Set(rows.map(row => row.id)));
    setDays(readDaysOf(rows));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [rows, mark] = await Promise.all([getReadItems(), getReadingBaseline()]);
        if (!live.current) return;
        adopt(rows);
        setBaseline(mark);
      } catch (error) {
        // A store that cannot be read is no marks and no baseline, which the
        // instrument already reports as "not synced" rather than "all read".
        if (import.meta.env.DEV) console.error('Failed to read read-state:', error);
      }
    })();
  }, [adopt]);

  useEffect(() => {
    if (!synced) return;
    void (async () => {
      try {
        const mark = await ensureReadingBaseline();
        // A mark is an edit like any other, and an edit that never reaches the
        // journal is an edit the other device never sees. The debounce inside
        // collapses a burst, and an empty outbox costs nothing.
        scheduleFlush();
        if (live.current) setBaseline(mark);
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to establish the reading baseline:', error);
      }
    })();
  }, [synced]);

  const toggle = useCallback(
    (key: string) => {
      const wanted = !marked.has(key);
      // Optimistic, and reverted on a throw. The write either happened or it
      // did not; a tick that flips back is the honest report of the second.
      setMarked(previous => {
        const next = new Set(previous);
        if (wanted) next.add(key);
        else next.delete(key);
        return next;
      });
      const ticket = latest.current + 1;
      latest.current = ticket;
      void (async () => {
        try {
          await setItemRead(key, wanted);
          scheduleFlush();
          if (!live.current) return;
          const rows = await getReadItems();
          if (live.current && ticket === latest.current) adopt(rows);
        } catch (error) {
          if (import.meta.env.DEV) console.error('Failed to record read-state:', error);
          if (!live.current) return;
          setMarked(previous => {
            const next = new Set(previous);
            if (wanted) next.delete(key);
            else next.add(key);
            return next;
          });
        }
      })();
    },
    [adopt, marked]
  );

  const day = baselineDay(baseline);

  const isRead = useCallback((key: string) => marked.has(key), [marked]);
  const unread = useCallback(
    (items: readonly ReadableItem[]) => countUnread(items, day, marked),
    [day, marked]
  );
  const spent = useCallback((item: ReadableItem) => isSpent(item, day, marked), [day, marked]);

  return { isRead, toggle, unread, spent, days };
}
