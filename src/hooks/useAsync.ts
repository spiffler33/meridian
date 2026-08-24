/**
 * One asynchronous read, tracked.
 *
 * Every surface in the reading pane does the same thing: run a read, show a
 * quiet line while it is out, then show either the answer or what went wrong.
 * The loader is a `useCallback` in the caller, which is what makes the
 * dependency honest — the read re-runs when its inputs change, and not
 * otherwise.
 */

import { useEffect, useState } from 'react';

export interface AsyncState<T> {
  value: T | null;
  error: unknown;
  pending: boolean;
}

function pending<T>(): AsyncState<T> {
  return { value: null, error: null, pending: true };
}

export function useAsync<T>(run: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(pending<T>);
  const [previous, setPrevious] = useState<() => Promise<T>>(() => run);

  if (previous !== run) {
    // Reset here rather than in the effect below. What is on screen belongs to
    // the read that just went stale, and leaving it up under the new one shows
    // the wrong file for a frame; doing it in an effect costs a second render
    // to say the same thing.
    setPrevious(() => run);
    setState(pending<T>());
  }

  useEffect(() => {
    let live = true;
    run().then(
      value => {
        if (live) setState({ value, error: null, pending: false });
      },
      error => {
        if (live) setState({ value: null, error, pending: false });
      }
    );
    return () => {
      live = false;
    };
  }, [run]);

  return state;
}
