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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const scheduleFlushMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/sync', () => ({ scheduleFlush: scheduleFlushMock }));

// Coding is lazy and runs in the background after every capture (usePulses).
// Mocked explicitly rather than left to the coder's own no-API-key fallback,
// so these tests are not racing an unconfigured default.
const codePulseMock = vi.hoisted(() => vi.fn(async (): Promise<import('../services/coder').Coding | null> => null));
vi.mock('../services/coder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/coder')>();
  return { ...actual, codePulse: codePulseMock };
});

import { closeDb, outboxSize, peekOutbox } from '../lib/db';
import type { OutboxRecord } from '../lib/db';
import { ENTITY, resetSession } from '../lib/entities';
import type { JournalEvent } from '../lib/journal';
import { PulseView } from './PulseView';
import type { Coding } from '../services/coder';

const NOW = new Date('2026-08-27T12:00:00.000Z');

const SAMPLE_CODING: Coding = {
  signal: 'note',
  domain: null,
  activity: null,
  people: [],
  span: { start: '2026-08-27T12:00:00.000Z', end: null, approx: false },
  links: { habitId: null, towerId: null, eventId: null },
  effects: [],
  vocabProposal: null,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetSession();
  codePulseMock.mockReset();
  codePulseMock.mockImplementation(async () => null);
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
    // Finds the create event specifically rather than asserting the outbox's
    // total size: capture also fires the lazy coding queue in the background
    // (usePulses), which may queue its own vocab-seed event racing this read.
    const created = queued.find(
      (event): event is Extract<JournalEvent, { type: 'upsert' }> & OutboxRecord =>
        event.type === 'upsert' && event.entity === ENTITY.pulse && 'text' in event.fields
    );
    expect(created).toBeDefined();
    // Trimmed, and nothing beyond the two fields createPulse ever writes.
    expect(created?.fields).toEqual({ text: 'wrote the plan', at: expect.any(String) });

    // Let the background coding sweep's own vocab-seed write (buildCoderContext
    // always finishes, seed included, before codePulse is called) land before
    // this test ends, so it cannot dangle into the next test's fresh database.
    await waitFor(() => expect(codePulseMock).toHaveBeenCalled());
  });

  it('does nothing on an empty enter', async () => {
    render(<PulseView />);
    const box = await screen.findByLabelText('capture a pulse');

    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await outboxSize()).toBe(0);
    expect(scheduleFlushMock).not.toHaveBeenCalled();
  });
});

describe('the coding dot', () => {
  it('is hollow for an uncoded pulse, and stays hollow when the coder has nothing to offer', async () => {
    render(<PulseView />);
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;

    fireEvent.change(box, { target: { value: 'stays uncoded' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    const line = await screen.findByText('stays uncoded');
    const dot = line.closest('li')?.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass('bg-transparent');
    expect(dot).not.toHaveClass('bg-text-muted');

    // No spinner, no error rendered anywhere in the stream — uncoded is calm.
    expect(line.closest('li')?.querySelector('[role="status"], [role="alert"]')).toBeNull();

    // Let the background sweep's own vocab-seed write land before this test
    // ends, so it cannot dangle into the next test's fresh database.
    await waitFor(() => expect(codePulseMock).toHaveBeenCalled());
  });

  it('fills once the coder returns a coding', async () => {
    codePulseMock.mockImplementation(async () => SAMPLE_CODING);

    render(<PulseView />);
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;

    fireEvent.change(box, { target: { value: 'gets coded' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    const line = await screen.findByText('gets coded');
    await waitFor(() => {
      const dot = line.closest('li')?.querySelector('[aria-hidden="true"]');
      expect(dot).toHaveClass('bg-text-muted');
      expect(dot).not.toHaveClass('bg-transparent');
    });
  });
});
