/**
 * Tower's box, now that one submission is two records.
 *
 * The thing this file exists to protect is the behaviour the owner already
 * liked: Enter, and the item is there, from the raw text, with nothing between
 * the two. The coder joined the path and must not have changed that — so the
 * first test runs it against a coder that never answers at all, and the item
 * still has to be on screen.
 *
 * Nothing below the view is mocked except the one network call: `AppProvider`,
 * `useTowerPulses`, `captureTowerItem` and the fold all run for real against
 * fake-indexeddb, because "the item appears without a reload" is a claim about
 * the wiring between a commit and the reducer, and a stub would prove nothing
 * about it. `syncDown` needs no stubbing either: with no token it returns null,
 * so nothing here can be explained by a pull.
 *
 * Every test captures its OWN line, and the coder answers only for that line.
 * That is not decoration: capture fires the coding without awaiting it (fence
 * 3), so a test ends with its coding still running, and it finishes inside a
 * LATER test — against a fresh database, for a pulse id that no longer exists,
 * where the enrichment resurrects a textless ghost pulse (P2). Measured at
 * about one run in twelve, failing an assertion three tests away from the
 * capture that caused it. A coder that never settles for a line it was not set
 * up for cannot write anything, whenever it happens to be called.
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
import { installSyncTriggers } from '../lib/sync';
import { getPulses, getTowerItems } from '../services/data';
import type { CoderContext, Coding } from '../services/coder';
import { AppProvider } from '../store/AppContext';
import TowerView from './TowerView';

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
  codePulseMock.mockReset();
  codePulseMock.mockImplementation(NEVER);
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  scheduleFlushMock.mockClear();
  // Cancels any trigger the provider left installed, so nothing fires against
  // a database that is about to be deleted.
  installSyncTriggers()();
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

/**
 * The pulse the store holds — and the assertion that there is exactly one.
 *
 * One submission is one item and one pulse. Indexing `[0]` instead would read
 * whichever row the fold happened to return first, which is how the leak the
 * module note describes announced itself: as a baffling diff rather than as a
 * count.
 */
async function onlyPulse() {
  const rows = await getPulses();
  expect(rows).toHaveLength(1);
  return rows[0];
}

/**
 * A coder that proposes `changes` on the item it is shown, for `line` and for
 * nothing else.
 *
 * The item is resolved by ID out of the `openTowerItems` the model was given,
 * which is the only way an effect can name a task. A call carrying any other
 * line belongs to another test and never answers.
 */
function proposeFor(line: string, changes: Record<string, unknown>) {
  codePulseMock.mockImplementation(async (text: string, context: CoderContext) => {
    if (text !== line) return NEVER();
    const target = context.openTowerItems.find((item) => item.text === line);
    if (target === undefined) return null;
    return { ...CODING, effects: [{ type: 'updateTask' as const, towerId: target.id, ...changes }] };
  });
}

describe('capturing into Tower', () => {
  it('shows the item immediately, from the raw text, with the coder never awaited', async () => {
    // The coder here never answers — the strongest form of "slow". If anything
    // on the capture path awaited it, nothing below could ever run.
    renderTower();

    await capture('  call the plumber  ');

    // In the reducer and on screen without a reload: the write goes straight
    // through the data layer in one commit, and `onLocalWrite` is what tells
    // the provider to re-read.
    expect(await screen.findByText('call the plumber')).toBeInTheDocument();

    // Cleared AND ready for the next line while the coder is still out. This
    // is what "capture never blocks" looks like from the owner's side, and the
    // only assertion here that an `await` on the coding would break: the item
    // itself lands before the coder is even called, so its presence proves
    // nothing about the ordering.
    const box = (await screen.findByPlaceholderText('what needs doing?')) as HTMLInputElement;
    await waitFor(() => {
      expect(box).not.toBeDisabled();
    });
    expect(box.value).toBe('');

    // And the same submission is in the stream, verbatim, as the other mouth.
    const pulse = await onlyPulse();
    expect(pulse.text).toBe('call the plumber');
    expect(pulse.mouth).toBe('tower');
    // Uncoded, and calm about it: the item is the whole outcome.
    expect(pulse.signal).toBeUndefined();
    expect(pulse.links?.towerId).toBe((await getTowerItems())[0].id);
    expect(scheduleFlushMock).toHaveBeenCalled();
  });

  it('is one item and one pulse on a double Enter, not two', async () => {
    renderTower();
    const box = (await screen.findByPlaceholderText('what needs doing?')) as HTMLInputElement;

    fireEvent.change(box, { target: { value: 'chase the roof quote' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await screen.findByText('chase the roof quote')).toBeInTheDocument();
    expect(await getTowerItems()).toHaveLength(1);
    await onlyPulse();
  });
});

describe('the proposals the coder puts on an item', () => {
  it('arrives as a chip on the item, after the item, and applies to it', async () => {
    const LINE = 'the landlord is fixing the boiler';
    proposeFor(LINE, { status: 'waiting', waitingOn: 'the landlord', expectsBy: '2026-09-04' });
    renderTower();

    await capture(LINE);
    expect(await screen.findByText(LINE)).toBeInTheDocument();

    // The chip says only what would change: the task is the line above it.
    fireEvent.click(await screen.findByText('waiting, waiting on the landlord, by 2026-09-04'));

    await waitFor(async () => {
      const [item] = await getTowerItems();
      expect(item.status).toBe('waiting');
      expect(item.waitingOn).toBe('the landlord');
      expect(item.expectsBy).toBe('2026-09-04');
    });
    // Held rather than active, so Tower has moved it out of Now — and the
    // proposal is gone from the pulse it came from, which is the only place
    // either surface reads a chip from.
    await waitFor(() => {
      expect(screen.getByText(/Follow Up \(1\)/)).toBeInTheDocument();
    });
    expect((await onlyPulse()).effects).toEqual([]);
  });

  it('the × drops the chip and leaves the item alone', async () => {
    const LINE = 'the garage door is sorted';
    proposeFor(LINE, { status: 'done' });
    renderTower();

    await capture(LINE);
    const chip = await screen.findByText('done');

    fireEvent.click(screen.getByLabelText('dismiss done'));

    await waitFor(() => {
      expect(chip).not.toBeInTheDocument();
    });
    const [item] = await getTowerItems();
    expect(item.status).toBe('active');
    // The coding survives; a dismissed chip changes what is offered, not how
    // the line was read.
    const pulse = await onlyPulse();
    expect(pulse.signal).toBe('task');
    expect(pulse.effects).toEqual([]);
  });

  it('renders nothing under an item the coder proposed nothing for', async () => {
    const LINE = 'book the annual service';
    codePulseMock.mockImplementation(async (text: string) => (text === LINE ? CODING : NEVER()));
    renderTower();

    await capture(LINE);
    expect(await screen.findByText(LINE)).toBeInTheDocument();

    await waitFor(async () => {
      expect((await onlyPulse()).signal).toBe('task');
    });
    expect(screen.queryByRole('button', { name: /^dismiss/ })).toBeNull();
  });
});
