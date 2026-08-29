/**
 * usePulses: the coding triggers wired around capture and open.
 *
 * The pulse entity, the fold, and `codeUncodedPulses` itself are pinned in
 * `lib/pulse.test.ts` against the real coder module (with only its network
 * call mocked). This file is about the HOOK's own wiring: that capture never
 * awaits the coder no matter how it behaves (O1), that the backlog sweep
 * fires on open while a capture codes only its own line, and that neither
 * path can take a captured line back off the screen.
 *
 * Every test captures its OWN line, and its coder answers only for that line
 * (`answerFor`), exactly as `views/TowerView.test.tsx` does it. That is not
 * decoration: capture and the sweep both fire their coding without awaiting it
 * (fence 3), so a test ends with a coding still walking `buildCoderContext`,
 * and it reaches `codePulse` inside a LATER test — against a fresh database,
 * where the enrichment resurrects a textless ghost pulse (P2) and schedules a
 * flush for it. Measured: a straggler settling inside the D6 test below makes
 * its flush count 3 instead of 2. A coder that never settles for a line it was
 * not set up for cannot write anything, whenever it happens to be called.
 *
 * For the same reason nothing here counts the spy's TOTAL calls: a straggler
 * inflates that too. `codedTimes(line)` is the honest count.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleFlushMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/sync', () => ({ scheduleFlush: scheduleFlushMock }));

const codePulseMock = vi.hoisted(() => vi.fn());
vi.mock('../services/coder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/coder')>();
  return { ...actual, codePulse: codePulseMock };
});

/**
 * A gate on the hook's first read of the store, so a test can put a capture
 * inside the window between a refresh reading the store and that refresh
 * reaching the list. Everything else in `data` stays real.
 */
const readGate = vi.hoisted(() => ({ hold: null as Promise<void> | null, entered: null as (() => void) | null }));
vi.mock('../services/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/data')>();
  return {
    ...actual,
    getPulses: async () => {
      const rows = await actual.getPulses();
      const hold = readGate.hold;
      if (hold) {
        readGate.hold = null;
        readGate.entered?.();
        await hold;
      }
      return rows;
    },
  };
});

import { closeDb, enqueue } from '../lib/db';
import { ENTITY, resetSession } from '../lib/entities';
import type { JournalEvent } from '../lib/journal';
import { usePulses } from './usePulses';
import { CODER_REV } from '../services/coder';
import type { Coding } from '../services/coder';
import { getPulses } from '../services/data';

const DAY = '2026-08-28';
const ZONE = 'America/Los_Angeles';

// Frozen so a `capture()` call's real-clock write (`createPulse` stamps `at`
// via `nowIso()`) cannot land on a different calendar day than DAY once the
// wall clock crosses local midnight mid-run. Noon UTC sits safely inside
// 2026-08-28 in ZONE and in the host machine's own local zone alike.
const NOW = new Date('2026-08-28T12:00:00.000Z');

const SAMPLE_CODING: Coding = {
  signal: 'note',
  domain: null,
  activity: null,
  people: [],
  span: { start: '2026-08-28T09:00:00.000Z', end: null, approx: false },
  links: { eventId: null },
  nutrition: null,
  coderRev: CODER_REV,
  effects: [],
  vocabProposal: null,
};

/** A coder that has been reached and will never answer. It cannot write. */
const NEVER = () => new Promise<Coding | null>(() => undefined);

/** A coder that answers `coding` for `line`, and never for anything else. */
function answerFor(line: string, coding: Coding | null = SAMPLE_CODING) {
  codePulseMock.mockImplementation(async (text: string) => (text === line ? coding : NEVER()));
}

/** How many coder calls this line drew — never the spy's total (see the note above). */
function codedTimes(line: string): number {
  return (codePulseMock.mock.calls as Array<[string]>).filter(([text]) => text === line).length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetSession();
  scheduleFlushMock.mockClear();
  codePulseMock.mockReset();
  readGate.hold = null;
  readGate.entered = null;
});

afterEach(async () => {
  vi.useRealTimers();
  resetSession();
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('meridian');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
    request.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'));
  });
});

describe('capture never blocks on the coder (O1, fence 3)', () => {
  it('resolves and renders even while the coder call is permanently hung', async () => {
    const LINE = 'captured with the coder stuck';
    let releaseCoder: (() => void) | undefined;
    codePulseMock.mockImplementation((text: string) =>
      text === LINE
        ? new Promise<Coding | null>((resolve) => {
            releaseCoder = () => resolve(null);
          })
        : NEVER()
    );

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.capture(LINE);
    });

    expect(ok).toBe(true);
    expect(result.current.today.map((row) => row.text)).toEqual([LINE]);

    // buildCoderContext (its own vocab-seed write included) always finishes
    // before codePulse is called, so this proves that write has already
    // landed before releasing the still-hung call and ending the test —
    // otherwise it could dangle into the next test's fresh database.
    await waitFor(() => expect(codedTimes(LINE)).toBe(1));
    releaseCoder?.();
  });

  it('resolves and renders even when the coder rejects outright', async () => {
    const LINE = 'captured while offline';
    codePulseMock.mockImplementation(async (text: string) => {
      if (text !== LINE) return NEVER();
      throw new Error('offline');
    });

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.capture(LINE);
    });

    expect(ok).toBe(true);
    expect(result.current.today.map((row) => row.text)).toEqual([LINE]);

    // Same reasoning: let the vocab-seed write land before this test ends.
    await waitFor(() => expect(codedTimes(LINE)).toBe(1));
  });
});

describe('the lazy coding queue', () => {
  it('codes on save: a captured pulse goes from uncoded to coded without another capture', async () => {
    const LINE = 'needs coding';
    answerFor(LINE);

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));

    await act(async () => {
      await result.current.capture(LINE);
    });

    // The dot flips from hollow to filled once the coding this triggers lands
    // — one call for this line, not a re-walk of the whole history.
    await waitFor(() => {
      expect(result.current.today.find((row) => row.text === LINE)?.signal).toBe('note');
    });
    expect(codedTimes(LINE)).toBe(1);
  });

  it('codes on open: a pulse left uncoded from a previous session gets coded on mount, with no capture at all', async () => {
    const LINE = 'left over from last time';
    await enqueue([
      {
        id: 'e1',
        device: 'a',
        seq: 1,
        ts: Date.parse('2026-08-28T08:00:00.000Z'),
        type: 'upsert',
        entity: ENTITY.pulse,
        entityId: 'p1',
        fields: { text: LINE, at: '2026-08-28T08:00:00.000Z' },
      } satisfies JournalEvent,
    ]);
    answerFor(LINE);

    const { result } = renderHook(() => usePulses(DAY, ZONE));

    await waitFor(() => {
      expect(result.current.today.find((row) => row.text === LINE)?.signal).toBe('note');
    });
    expect(codedTimes(LINE)).toBe(1);
  });

  it('once per pulse: re-mounting after a pulse is already coded makes no further coder call (P1)', async () => {
    const LINE = 'only pulse today';
    answerFor(LINE);

    const first = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(first.result.current.today).toEqual([]));
    await act(async () => {
      await first.result.current.capture(LINE);
    });
    await waitFor(() => {
      expect(first.result.current.today.find((row) => row.text === LINE)?.signal).toBe('note');
    });
    first.unmount();

    expect(codedTimes(LINE)).toBe(1);

    // A real re-open, not just a fresh mount: `resetSession()` drops the
    // memoised fold so the second mount rebuilds it from journalCache +
    // outbox. Without it this proves only that a live in-memory row is not
    // re-coded, which is not what P1 claims.
    resetSession();

    const second = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(second.result.current.today.length).toBe(1));

    expect(codedTimes(LINE)).toBe(1); // no additional call
    second.unmount();
  });
});

describe('a capture is never lost to a refresh that started before it (D8)', () => {
  it('keeps a line captured while the store was being read, instead of replacing the list with the older read', async () => {
    const STORED = 'already in the store';
    const CAPTURED = 'the line that must not vanish';
    // One pulse already in the store, left uncoded, and a coder that never
    // answers: the mount's sweep parks on it, so nothing after the held read
    // can quietly repair the list and hide the clobber.
    await enqueue([
      {
        id: 'e1',
        device: 'a',
        seq: 1,
        ts: Date.parse('2026-08-28T08:00:00.000Z'),
        type: 'upsert',
        entity: ENTITY.pulse,
        entityId: 'p1',
        fields: { text: STORED, at: '2026-08-28T08:00:00.000Z' },
      } satisfies JournalEvent,
    ]);
    const releaseCoder: Array<() => void> = [];
    codePulseMock.mockImplementation((text: string) =>
      text === STORED || text === CAPTURED
        ? new Promise<Coding | null>((resolve) => {
            releaseCoder.push(() => resolve(null));
          })
        : NEVER()
    );

    // The mount's read is held open once it has seen the store: it will reach
    // the list only after the capture below has landed in it.
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      readGate.entered = resolve;
    });
    readGate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await act(async () => {
      await entered;
    });

    await act(async () => {
      await result.current.capture(CAPTURED);
    });
    expect(result.current.today.map((row) => row.text)).toEqual([CAPTURED]);

    await act(async () => {
      release?.();
      await entered;
    });

    // "Your line disappeared" is the one failure capture must not have: the
    // held read predates it, and the store's answer for everything else must
    // not take it off the screen.
    await waitFor(() => {
      expect(result.current.today.map((row) => row.text)).toEqual([STORED, CAPTURED]);
    });

    await waitFor(() => expect(codedTimes(STORED) + codedTimes(CAPTURED)).toBeGreaterThan(0));
    releaseCoder.forEach((resolve) => resolve());
  });
});

describe('the coding write is pushed, not left sitting in the outbox (D6)', () => {
  it('schedules a flush after the enrichment lands, not only after the capture', async () => {
    const LINE = 'needs pushing';
    answerFor(LINE);

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));
    scheduleFlushMock.mockClear();

    await act(async () => {
      await result.current.capture(LINE);
    });

    // One for the capture itself, one for the coding. Without the second, the
    // enrichment waits for an unrelated edit or a foreground before the other
    // device can see it — and until then that device re-codes the same pulse.
    await waitFor(() => expect(scheduleFlushMock).toHaveBeenCalledTimes(2));
  });
});

describe('a write that already landed is never re-reported as lost (F6)', () => {
  it('does not resolve false — or drop the row — when scheduleFlush throws after the save', async () => {
    const LINE = 'saved before the flush blew up';
    scheduleFlushMock.mockImplementationOnce(() => {
      throw new Error('scheduleFlush exploded');
    });

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));

    // The old shape put scheduleFlush() inside createPulse's own try, so its
    // throw landed in the catch built for "the write never happened" and
    // capture() answered false — the caller hands the text back, and a
    // second Enter makes a duplicate pulse for the one line the owner said
    // once. The fix narrows that try to the write alone, so a scheduleFlush
    // failure propagates instead of being reported as a lost save.
    await act(async () => {
      await expect(result.current.capture(LINE)).rejects.toThrow('scheduleFlush exploded');
    });

    // The save landed regardless — this is the whole reason `false` would
    // have been the wrong answer.
    await waitFor(async () => {
      expect((await getPulses()).some((row) => row.text === LINE)).toBe(true);
    });
  });
});
