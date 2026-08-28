/**
 * PulseView: the capture box's autofocus, and pulse capture itself.
 *
 * Two things are pinned here that live nowhere else. First, that the capture
 * box actually receives DOM focus on mount — arriving on the page is the
 * gesture now, so there is no prop to assert against, only the DOM. Second,
 * that typing a line and hitting Enter is the real path end to end: `usePulses`
 * and `createPulse` run against fake-indexeddb with nothing mocked, so what
 * lands in the outbox is what `commit` actually wrote and the render is the
 * real fold's answer, not a stub. `scheduleFlush` is mocked so the assertion
 * on it pins reuse — capture goes through the same push path as every other
 * write rather than inventing its own — and so no real timer or network
 * survives the test.
 *
 * PulseView reads no app state — `useApp` belongs to Tower, not this view —
 * so nothing here mocks it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const scheduleFlushMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/sync', () => ({ scheduleFlush: scheduleFlushMock }));

import { closeDb, outboxSize, peekOutbox } from '../lib/db';
import type { OutboxRecord } from '../lib/db';
import { ENTITY, resetSession } from '../lib/entities';
import type { JournalEvent } from '../lib/journal';
import { PulseView } from './PulseView';

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

describe('the capture box', () => {
  it('autofocuses on mount', async () => {
    render(<PulseView />);

    expect(await screen.findByLabelText('capture a pulse')).toHaveFocus();
  });

  it('escape blurs it', async () => {
    render(<PulseView />);
    const box = await screen.findByLabelText('capture a pulse');
    expect(box).toHaveFocus();

    fireEvent.keyDown(box, { key: 'Escape' });

    expect(box).not.toHaveFocus();
  });
});

describe('capture', () => {
  it('renders optimistically, clears the field, and reuses the outbox/flush path', async () => {
    render(<PulseView />);
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

  it('does nothing on an empty enter', async () => {
    render(<PulseView />);
    const box = await screen.findByLabelText('capture a pulse');

    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await outboxSize()).toBe(0);
    expect(scheduleFlushMock).not.toHaveBeenCalled();
  });
});
