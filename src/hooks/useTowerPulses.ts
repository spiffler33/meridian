/**
 * Tower's half of "one parser, two mouths".
 *
 * Tower's box behaves exactly as it always has — Enter, and the item is there,
 * from the raw text, with nothing in between. What changed is that the same
 * submission is also recorded as a pulse, in the SAME commit, so the coder
 * reaches it; and that the coder's answer comes back as proposals shown on the
 * item itself.
 *
 * The item is `AppContext`'s to render, and it stays that way: this hook never
 * touches it. `captureTowerItem` tells the provider to re-read (`onLocalWrite`)
 * and the reducer holds the item as before. What this hook holds is the pulse
 * side — the proposals, and the two ways out of one.
 *
 * The backlog sweep is deliberately absent. "Uncoded pulses are coded on next
 * open" means the Pulse page's open, which is where the sweep lives and where
 * it is capped; a capture here codes its own line and nothing else, so opening
 * Tower after a week away cannot become a burst of paid calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { towerProposals } from '../lib/pulse';
import type { TowerProposal } from '../lib/pulse';
import { scheduleFlush } from '../lib/sync';
import {
  applyPulseEffect,
  captureTowerItem,
  codeCapturedPulse,
  dismissPulseEffect,
  getPulses,
} from '../services/data';

export interface TowerPulses {
  /** The `updateTask` proposals awaiting a tap, by the tower item id they name. */
  proposals: Readonly<Record<string, TowerProposal[]>>;
  /** Capture one line. Resolves false when nothing was saved, so the box can keep the text. */
  capture: (text: string) => Promise<boolean>;
  /** Apply the proposal, and drop its chip from both surfaces. */
  apply: (proposal: TowerProposal) => void;
  /** Drop the chip and keep the coding. */
  dismiss: (proposal: TowerProposal) => void;
}

export function useTowerPulses(): TowerPulses {
  const [proposals, setProposals] = useState<Readonly<Record<string, TowerProposal[]>>>({});

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
   * Every pulse, not the day's: a Tower item lives for weeks, and the line
   * that proposed something about it may have been said long before the item
   * reached the top of the page.
   */
  const refresh = useCallback(async () => {
    const stored = await getPulses();
    if (!live.current) return;
    setProposals(towerProposals(stored));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (error) {
        // No proposals is what most items have anyway; the next read catches up.
        if (import.meta.env.DEV) console.error('Failed to read pulse proposals:', error);
      }
    })();
  }, [refresh]);

  const capture = useCallback(async (text: string): Promise<boolean> => {
    if (text.trim().length === 0) return false;
    try {
      const { pulseId } = await captureTowerItem(text);
      // Same push path as every other write; the debounce collapses a burst.
      scheduleFlush();
      // Fired, not awaited (fence 3): the item is already on screen and the
      // coder is the slowest thing in the app. Not tied to the mount either —
      // this is one call for the line just typed, and navigating away the same
      // second should not throw its answer away.
      void (async () => {
        try {
          await codeCapturedPulse(pulseId);
          await refresh();
        } catch (error) {
          if (import.meta.env.DEV) console.error('Failed to code a captured task:', error);
        }
      })();
      return true;
    } catch (error) {
      // Neither half landed — that is what the single commit buys. The text is
      // the caller's to hand back; losing it is the one failure capture must
      // not have.
      if (import.meta.env.DEV) console.error('Failed to capture a task:', error);
      return false;
    }
  }, [refresh]);

  /**
   * Act on a chip, then re-read. Not optimistic: the answer is whatever the
   * fold says afterwards, and the write is local, so the wait is a frame.
   */
  const act = useCallback((work: () => Promise<void>) => {
    void (async () => {
      try {
        await work();
        scheduleFlush();
      } catch (error) {
        // The chip is still there and still tappable, which is the honest
        // report: nothing happened.
        if (import.meta.env.DEV) console.error('Failed to act on a task proposal:', error);
      }
      try {
        await refresh();
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to re-read pulse proposals:', error);
      }
    })();
  }, [refresh]);

  // Straight through the data layer's own serialized path — the same two
  // arguments the chip on the pulse line passes. One stored proposal, one act,
  // whichever page it was tapped on.
  const apply = useCallback(
    (proposal: TowerProposal) => act(() => applyPulseEffect(proposal.pulseId, proposal.index)),
    [act]
  );
  const dismiss = useCallback(
    (proposal: TowerProposal) => act(() => dismissPulseEffect(proposal.pulseId, proposal.index)),
    [act]
  );

  return { proposals, capture, apply, dismiss };
}
