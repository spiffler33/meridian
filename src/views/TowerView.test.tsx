/**
 * Tower's box, back to one record for one submission.
 *
 * Phase 4 undid "one parser, two mouths". Tower is a manual, intentional space
 * (fence 9): Enter, and the item is there, from the raw text, with nothing
 * between the two — no pulse written, no coder called, no chip on any item.
 * The behaviour the owner already liked is all there is left to protect, and
 * the coder's absence is now a thing to assert rather than a thing to survive.
 *
 * `codePulse` is mocked so its absence can be PROVED rather than assumed: a
 * real one would be silent here anyway (no key), which would let a call slip
 * back onto this path unnoticed. `scheduleFlush` is mocked only so no real
 * debounce timer or push outlives a test, never to assert on — `AppContext`
 * imports it from the same module and fires it on every state change, so an
 * assertion on it would say nothing about capture.
 *
 * Everything else runs for real against fake-indexeddb — `AppProvider`,
 * `createTowerItem`, the fold — because "the item appears without a reload" is
 * a claim about the wiring between a commit and the reducer, and a stub would
 * prove nothing about it. `syncDown` needs no stubbing: with no token it
 * returns null, so nothing here can be explained by a pull.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const scheduleFlushMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sync')>();
  return { ...actual, scheduleFlush: scheduleFlushMock };
});

const codePulseMock = vi.hoisted(() => vi.fn());
vi.mock('../services/coder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/coder')>();
  return { ...actual, codePulse: codePulseMock };
});

import { closeDb } from '../lib/db';
import { resetSession } from '../lib/entities';
import { getPulses, getTowerItems } from '../services/data';
import type { Coding } from '../services/coder';
import { AppProvider } from '../store/AppContext';
import TowerView from './TowerView';

const NOW = new Date('2026-08-28T12:00:00.000Z');

/** A coder that has been reached and will never answer. It cannot write. */
const NEVER = () => new Promise<Coding | null>(() => undefined);

beforeEach(() => {
  // Date only. Faking timers wholesale deadlocks `waitFor`.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetSession();
  codePulseMock.mockReset();
  codePulseMock.mockImplementation(NEVER);
});

afterEach(async () => {
  // `cleanup()` unmounts the provider, and its effect teardown is what removes
  // the sync listeners it installed and clears the flush debounce — both live
  // in the closure `installSyncTriggers` returned to it, which nothing else
  // can reach. Nothing fires against the database deleted below.
  cleanup();
  vi.useRealTimers();
  scheduleFlushMock.mockClear();
  resetSession();
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('meridian');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
    request.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'));
  });
});

function renderTower() {
  render(
    <AppProvider>
      <TowerView mirror={null} />
    </AppProvider>
  );
}

async function capture(text: string): Promise<void> {
  const box = (await screen.findByPlaceholderText('what needs doing?')) as HTMLInputElement;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

describe('capturing into Tower', () => {
  it('shows the item immediately, from the raw text', async () => {
    renderTower();

    await capture('  call the plumber  ');

    // In the reducer and on screen without a reload: the write goes through
    // the data layer, and the provider's own dispatch is what repaints.
    expect(await screen.findByText('call the plumber')).toBeInTheDocument();

    const box = (await screen.findByPlaceholderText('what needs doing?')) as HTMLInputElement;
    await waitFor(() => {
      expect(box).not.toBeDisabled();
    });
    expect(box.value).toBe('');
  });

  it('writes no pulse and calls no coder — Tower is not a mouth (fence 9)', async () => {
    renderTower();

    await capture('chase the roof quote');
    expect(await screen.findByText('chase the roof quote')).toBeInTheDocument();

    // The item is the whole outcome. A submission here is a commitment the
    // owner made, not an utterance for a model to read: nothing about it
    // reaches the stream, and nothing about it is ever sent anywhere.
    expect(await getPulses()).toEqual([]);
    expect(codePulseMock).not.toHaveBeenCalled();
  });

  it('is one item on a double Enter, not two', async () => {
    renderTower();
    const box = (await screen.findByPlaceholderText('what needs doing?')) as HTMLInputElement;

    fireEvent.change(box, { target: { value: 'chase the roof quote' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await screen.findByText('chase the roof quote')).toBeInTheDocument();
    expect(await getTowerItems()).toHaveLength(1);
  });

  it('renders no chip on an item — the coder proposes nothing about Tower', async () => {
    renderTower();

    await capture('call the plumber');
    expect(await screen.findByText('call the plumber')).toBeInTheDocument();

    // Asserted as absence, which is the only way to state a deleted feature.
    // Every chip on this page rendered a `dismiss <label>` button (`Chip`), so
    // none anywhere is the whole claim — hero card, queue, and both drawers.
    expect(screen.queryByLabelText(/^dismiss /)).toBeNull();
  });
});
