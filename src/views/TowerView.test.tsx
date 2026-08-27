/**
 * TowerView: the `p` handoff into the capture box, and pulse capture itself.
 *
 * Two things are pinned here that live nowhere else. First, that
 * `focusCapture` actually reaches the DOM — the box gets real focus, not just
 * a prop — and that the view reports the request handled, which is what stops
 * App from re-focusing it on every render. Second, that typing a line and
 * hitting Enter is the real path end to end: `usePulses` and `createPulse`
 * run against fake-indexeddb with nothing mocked, so what lands in the outbox
 * is what `commit` actually wrote and the render is the real fold's answer,
 * not a stub. `scheduleFlush` is mocked so the assertion on it pins reuse —
 * capture goes through the same push path as every other write rather than
 * inventing its own — and so no real timer or network survives the test.
 *
 * The tower half of the view (state.tower, the four mutators) is inert: a
 * mocked `useApp` returns an empty tower and stub callbacks, none of which
 * this file exercises.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const scheduleFlushMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/sync', () => ({ scheduleFlush: scheduleFlushMock }));

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    state: { tower: [] },
    addTowerItem: vi.fn(),
    completeTowerItemById: vi.fn(),
    updateTowerItemById: vi.fn(),
    deleteTowerItemById: vi.fn(),
  }),
}));

import { closeDb, outboxSize, peekOutbox } from '../lib/db';
import type { OutboxRecord } from '../lib/db';
import { ENTITY, resetSession } from '../lib/entities';
import type { JournalEvent } from '../lib/journal';
import TowerView from './TowerView';

const NOW = new Date('2026-08-27T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetSession();
});

afterEach(async () => {
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

function show(focusCapture: boolean) {
  const onFocusHandled = vi.fn();
  render(<TowerView mirror={null} focusCapture={focusCapture} onFocusHandled={onFocusHandled} />);
  return { onFocusHandled };
}

describe('the p handoff', () => {
  it('focuses the capture box and reports the request handled', async () => {
    const { onFocusHandled } = show(true);

    expect(await screen.findByLabelText('capture a pulse')).toHaveFocus();
    expect(onFocusHandled).toHaveBeenCalled();
  });

  it('leaves focus alone when nothing asked for it', async () => {
    show(false);

    expect(await screen.findByLabelText('capture a pulse')).not.toHaveFocus();
  });
});

describe('capture', () => {
  it('renders optimistically, clears the field, and reuses the outbox/flush path', async () => {
    show(false);
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;

    fireEvent.change(box, { target: { value: '  wrote the plan  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await screen.findByText('wrote the plan')).toBeInTheDocument();
    expect(box.value).toBe('');
    expect(scheduleFlushMock).toHaveBeenCalled();

    const queued = await peekOutbox<JournalEvent & OutboxRecord>();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ type: 'upsert', entity: ENTITY.pulse });
    // Trimmed, and nothing beyond the two fields createPulse ever writes.
    expect(queued[0].fields).toEqual({ text: 'wrote the plan', at: expect.any(String) });
  });

  it('does nothing on an empty Enter', async () => {
    show(false);
    const box = await screen.findByLabelText('capture a pulse');

    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await outboxSize()).toBe(0);
    expect(scheduleFlushMock).not.toHaveBeenCalled();
  });
});
