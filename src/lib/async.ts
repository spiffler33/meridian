/**
 * The two ways this app keeps async work from overlapping.
 *
 * `queued` runs everything handed to it one at a time, in order. `singleFlight`
 * runs one thing at a time and hands every caller who arrives mid-run the same
 * promise. Both were written out in full in three or two places before this
 * module existed, with the same comments each time.
 *
 * Pure plumbing: no imports, no IndexedDB, no fetch.
 */

/**
 * A queue that runs work one call at a time, in call order.
 *
 * Each returned queue owns its own chain, so two of them never block each
 * other. The chain itself must never carry a rejection forward — one failed
 * turn would then fail every turn queued behind it — so the tail is always a
 * settled-to-undefined promise. The caller still sees its own result exactly
 * as it settled.
 */
export function queued(): <T>(work: () => Promise<T>) => Promise<T> {
  let chain: Promise<void> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

/**
 * One run at a time: a call arriving while a run is in flight joins it rather
 * than starting a second one, and its arguments are ignored.
 *
 * That is the intended behaviour at both call sites — a sync whose only
 * argument is the token, where the token cannot have changed in the seconds a
 * run takes. The memo clears when the run settles, so the next call starts a
 * fresh one.
 */
export function singleFlight<A extends unknown[], T>(
  run: (...args: A) => Promise<T>
): (...args: A) => Promise<T> {
  let running: Promise<T> | null = null;
  return (...args: A): Promise<T> => {
    if (!running) {
      running = run(...args).finally(() => {
        running = null;
      });
    }
    return running;
  };
}
