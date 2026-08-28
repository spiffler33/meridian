/**
 * useTowerPulses: the two things `views/TowerView.test.tsx` cannot say.
 *
 * The view test renders inside `AppProvider`, which imports `scheduleFlush`
 * from the same module and fires it on every state change — so an assertion
 * there could never attribute one to the capture. Here there is no provider,
 * and this hook is the only thing in the graph that calls it.
 *
 * And a chip re-tapped before its repaint needs a chip that survives the tap,
 * which a rendered list does not give you: the view clears it. The hook hands
 * back the proposal itself, so a test can hold one exactly as a finger holds a
 * button that has not moved yet.
 *
 * Everything below the hook is real against fake-indexeddb; only the coder's
 * network call and the push are mocked.
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

import { closeDb } from '../lib/db';
import { resetSession } from '../lib/entities';
import type { Coding } from '../services/coder';
import { createPulse, createTowerItem, enrichPulse, getPulses, getTowerItems } from '../services/data';
import { useTowerPulses } from './useTowerPulses';

const NOW = new Date('2026-08-28T12:00:00.000Z');

const CODING: Coding = {
  signal: 'task',
  domain: null,
  activity: null,
  people: [],
  span: { start: NOW.toISOString(), end: null, approx: false },
  links: { habitId: null, towerId: null, eventId: null },
  effects: [],
  vocabProposal: null,
};

/** A coder that has been reached and will never answer. It cannot write. */
const NEVER = () => new Promise<Coding | null>(() => undefined);

beforeEach(() => {
  // Date only. Faking timers wholesale deadlocks `waitFor`.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetSession();
  scheduleFlushMock.mockClear();
  codePulseMock.mockReset();
  // Nothing here needs a coding off the wire: the proposals are written
  // straight onto the row. A coder that never answers also cannot leak one
  // into the next test's fresh database.
  codePulseMock.mockImplementation(NEVER);
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

describe('capturing into Tower', () => {
  it('pushes through the same flush path as every other write', async () => {
    const { result } = renderHook(() => useTowerPulses());
    await waitFor(() => expect(result.current.proposals).toEqual({}));
    scheduleFlushMock.mockClear();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.capture('call the plumber');
    });

    expect(ok).toBe(true);
    // Attributable: no provider in this graph, and the coding that would
    // schedule the second one is still out (it never answers). An edit that
    // never reaches the journal is an edit the other device never sees.
    expect(scheduleFlushMock).toHaveBeenCalledTimes(1);
    expect(await getTowerItems()).toHaveLength(1);
  });
});

describe('acting on a proposal shown on the item', () => {
  /**
   * Two `updateTask` proposals from one line, on two different items — the
   * shape a stale position rots in.
   */
  async function twoProposals() {
    const first = await createTowerItem({ text: 'chase the roof quote' });
    const second = await createTowerItem({ text: 'the loft conversion' });
    const pulse = await createPulse('roofer is coming, and the loft can wait');
    await enrichPulse(pulse.id, {
      ...CODING,
      effects: [
        { type: 'updateTask', towerId: first.id, status: 'waiting', waitingOn: 'the roofer' },
        { type: 'updateTask', towerId: second.id, status: 'someday' },
      ],
    });
    return { first, second, pulse };
  }

  it('applies the proposal the chip carries, not whatever slid into its place', async () => {
    const { first, second, pulse } = await twoProposals();

    const { result } = renderHook(() => useTowerPulses());
    await waitFor(() => expect(result.current.proposals[first.id]).toHaveLength(1));

    // Read once, and held — which is what a chip on screen is. Its position in
    // the pulse's effects is 0; the other proposal's is 1.
    const chip = result.current.proposals[first.id][0];

    await act(async () => {
      result.current.apply(chip);
    });
    await waitFor(() => expect(scheduleFlushMock).toHaveBeenCalledTimes(1));
    await waitFor(async () => {
      expect((await getTowerItems()).find((item) => item.id === first.id)?.status).toBe('waiting');
    });

    // The same chip again: a double tap, or a repaint that never came because
    // the re-read after the first threw. The list it was read from has since
    // shifted, so position 0 now names the OTHER proposal — applying that one
    // would send an item to someday that the owner never touched, silently.
    await act(async () => {
      result.current.apply(chip);
    });
    await waitFor(() => expect(scheduleFlushMock).toHaveBeenCalledTimes(2));

    expect((await getTowerItems()).find((item) => item.id === second.id)?.status).toBe('active');
    // And it is still a proposal — untouched, not consumed by someone else's tap.
    const row = (await getPulses()).find((candidate) => candidate.id === pulse.id);
    expect(row?.effects).toEqual([{ type: 'updateTask', towerId: second.id, status: 'someday' }]);
  });

  it('dismisses the proposal the chip carries, on the same terms', async () => {
    const { first, second, pulse } = await twoProposals();

    const { result } = renderHook(() => useTowerPulses());
    await waitFor(() => expect(result.current.proposals[first.id]).toHaveLength(1));
    const chip = result.current.proposals[first.id][0];

    await act(async () => {
      result.current.dismiss(chip);
    });
    await waitFor(() => expect(scheduleFlushMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      result.current.dismiss(chip);
    });
    await waitFor(() => expect(scheduleFlushMock).toHaveBeenCalledTimes(2));

    const row = (await getPulses()).find((candidate) => candidate.id === pulse.id);
    expect(row?.effects).toEqual([{ type: 'updateTask', towerId: second.id, status: 'someday' }]);
    // Neither item was written to by either tap.
    expect((await getTowerItems()).find((item) => item.id === first.id)?.status).toBe('active');
    expect((await getTowerItems()).find((item) => item.id === second.id)?.status).toBe('active');
  });
});
