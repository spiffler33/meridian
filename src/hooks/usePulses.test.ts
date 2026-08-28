/**
 * usePulses: the coding triggers wired around capture and open.
 *
 * The pulse entity, the fold, and `codeUncodedPulses` itself are pinned in
 * `lib/pulse.test.ts` against the real coder module (with only its network
 * call mocked). This file is about the HOOK's own wiring: that capture never
 * awaits the coder no matter how it behaves (O1), that the backlog sweep
 * fires on open while a capture codes only its own line, and that neither
 * path can take a captured line back off the screen.
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
import type { Coding } from '../services/coder';

const DAY = '2026-08-28';
const ZONE = 'America/Los_Angeles';

const SAMPLE_CODING: Coding = {
  signal: 'note',
  domain: null,
  activity: null,
  people: [],
  span: { start: '2026-08-28T09:00:00.000Z', end: null, approx: false },
  links: { habitId: null, towerId: null, eventId: null },
  effects: [],
  vocabProposal: null,
};

beforeEach(() => {
  resetSession();
  scheduleFlushMock.mockClear();
  codePulseMock.mockReset();
  readGate.hold = null;
  readGate.entered = null;
});

afterEach(async () => {
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
    let releaseCoder: (() => void) | undefined;
    codePulseMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCoder = () => resolve(null);
        })
    );

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.capture('captured with the coder stuck');
    });

    expect(ok).toBe(true);
    expect(result.current.today.map((row) => row.text)).toEqual(['captured with the coder stuck']);

    // buildCoderContext (its own vocab-seed write included) always finishes
    // before codePulse is called, so this proves that write has already
    // landed before releasing the still-hung call and ending the test —
    // otherwise it could dangle into the next test's fresh database.
    await waitFor(() => expect(codePulseMock).toHaveBeenCalled());
    releaseCoder?.();
  });

  it('resolves and renders even when the coder rejects outright', async () => {
    codePulseMock.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.capture('captured while offline');
    });

    expect(ok).toBe(true);
    expect(result.current.today.map((row) => row.text)).toEqual(['captured while offline']);

    // Same reasoning: let the vocab-seed write land before this test ends.
    await waitFor(() => expect(codePulseMock).toHaveBeenCalled());
  });
});

describe('the lazy coding queue', () => {
  it('codes on save: a captured pulse goes from uncoded to coded without another capture', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));

    await act(async () => {
      await result.current.capture('needs coding');
    });

    // The dot flips from hollow to filled once the coding this triggers lands
    // — one call for this line, not a re-walk of the whole history.
    await waitFor(() => {
      expect(result.current.today.find((row) => row.text === 'needs coding')?.signal).toBe('note');
    });
    expect(codePulseMock).toHaveBeenCalledTimes(1);
  });

  it('codes on open: a pulse left uncoded from a previous session gets coded on mount, with no capture at all', async () => {
    await enqueue([
      {
        id: 'e1',
        device: 'a',
        seq: 1,
        ts: Date.parse('2026-08-28T08:00:00.000Z'),
        type: 'upsert',
        entity: ENTITY.pulse,
        entityId: 'p1',
        fields: { text: 'left over from last time', at: '2026-08-28T08:00:00.000Z' },
      } satisfies JournalEvent,
    ]);
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    const { result } = renderHook(() => usePulses(DAY, ZONE));

    await waitFor(() => {
      expect(result.current.today.find((row) => row.text === 'left over from last time')?.signal).toBe('note');
    });
    expect(codePulseMock).toHaveBeenCalledTimes(1);
  });

  it('once per pulse: re-mounting after a pulse is already coded makes no further coder call (P1)', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    const first = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(first.result.current.today).toEqual([]));
    await act(async () => {
      await first.result.current.capture('only pulse today');
    });
    await waitFor(() => {
      expect(first.result.current.today.find((row) => row.text === 'only pulse today')?.signal).toBe('note');
    });
    first.unmount();

    expect(codePulseMock).toHaveBeenCalledTimes(1);

    // A real re-open, not just a fresh mount: `resetSession()` drops the
    // memoised fold so the second mount rebuilds it from journalCache +
    // outbox. Without it this proves only that a live in-memory row is not
    // re-coded, which is not what P1 claims.
    resetSession();

    const second = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(second.result.current.today.length).toBe(1));

    expect(codePulseMock).toHaveBeenCalledTimes(1); // no additional call
    second.unmount();
  });
});

describe('a capture is never lost to a refresh that started before it (D8)', () => {
  it('keeps a line captured while the store was being read, instead of replacing the list with the older read', async () => {
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
        fields: { text: 'already in the store', at: '2026-08-28T08:00:00.000Z' },
      } satisfies JournalEvent,
    ]);
    const releaseCoder: Array<() => void> = [];
    codePulseMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCoder.push(() => resolve(null));
        })
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
      await result.current.capture('the line that must not vanish');
    });
    expect(result.current.today.map((row) => row.text)).toEqual(['the line that must not vanish']);

    await act(async () => {
      release?.();
      await entered;
    });

    // "Your line disappeared" is the one failure capture must not have: the
    // held read predates it, and the store's answer for everything else must
    // not take it off the screen.
    await waitFor(() => {
      expect(result.current.today.map((row) => row.text)).toEqual([
        'already in the store',
        'the line that must not vanish',
      ]);
    });

    await waitFor(() => expect(codePulseMock).toHaveBeenCalled());
    releaseCoder.forEach((resolve) => resolve());
  });
});

describe('the coding write is pushed, not left sitting in the outbox (D6)', () => {
  it('schedules a flush after the enrichment lands, not only after the capture', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    const { result } = renderHook(() => usePulses(DAY, ZONE));
    await waitFor(() => expect(result.current.today).toEqual([]));
    scheduleFlushMock.mockClear();

    await act(async () => {
      await result.current.capture('needs pushing');
    });

    // One for the capture itself, one for the coding. Without the second, the
    // enrichment waits for an unrelated edit or a foreground before the other
    // device can see it — and until then that device re-codes the same pulse.
    await waitFor(() => expect(scheduleFlushMock).toHaveBeenCalledTimes(2));
  });
});
