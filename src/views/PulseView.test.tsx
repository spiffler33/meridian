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
 *
 * Every test captures its OWN line, and a coder that answers a coding answers
 * only for that line (`answerFor`), exactly as `TowerView.test.tsx` does it.
 * Capture fires its coding without awaiting it (fence 3), so a test ends with
 * one still walking `buildCoderContext` and it reaches `codePulse` inside a
 * LATER test — against a fresh database, where the enrichment resurrects a
 * textless ghost pulse (P2). The `null` default in `beforeEach` is safe for
 * the same reason it is the default: a null coding writes nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const scheduleFlushMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/sync', () => ({ scheduleFlush: scheduleFlushMock }));

// Coding is lazy and runs in the background after every capture (usePulses).
// Mocked explicitly rather than left to the coder's own no-API-key fallback,
// so these tests are not racing an unconfigured default.
const codePulseMock = vi.hoisted(() =>
  vi.fn<(text: string) => Promise<import('../services/coder').Coding | null>>(async () => null)
);
vi.mock('../services/coder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/coder')>();
  return { ...actual, codePulse: codePulseMock };
});

import { closeDb, outboxSize, peekOutbox } from '../lib/db';
import type { OutboxRecord } from '../lib/db';
import { ENTITY, readPulseVocabRow, resetSession } from '../lib/entities';
import type { JournalEvent } from '../lib/journal';
import { PulseView } from './PulseView';
import { getPulses } from '../services/data';
import type { Coding } from '../services/coder';

const NOW = new Date('2026-08-27T12:00:00.000Z');

const SAMPLE_CODING: Coding = {
  signal: 'note',
  domain: null,
  activity: null,
  people: [],
  span: { start: '2026-08-27T12:00:00.000Z', end: null, approx: false },
  links: { eventId: null },
  effects: [],
  vocabProposal: null,
};

/** A coder that has been reached and will never answer. It cannot write. */
const NEVER = () => new Promise<Coding | null>(() => undefined);

/** A coder that answers `coding` for `line`, and never for anything else. */
function answerFor(line: string, coding: Coding) {
  codePulseMock.mockImplementation(async (text: string) => (text === line ? coding : NEVER()));
}

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
    answerFor('gets coded', SAMPLE_CODING);

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

/**
 * The chips.
 *
 * Rendered from the row, not from whatever the coder happened to return into a
 * variable: the tests below capture a line, let the coding land, and then read
 * the DOM — which is the same path a reload takes, and the reason the pulse row
 * stores its proposals at all.
 */
describe('effect chips', () => {
  it('renders nothing under a line whose coding proposed nothing', async () => {
    answerFor('just a note', SAMPLE_CODING);

    render(<PulseView />);
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'just a note' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    const line = await screen.findByText('just a note');
    await waitFor(() => {
      const dot = line.closest('li')?.querySelector('[aria-hidden="true"]');
      expect(dot).toHaveClass('bg-text-muted');
    });
    expect(line.closest('li')?.querySelectorAll('button')).toHaveLength(1); // the kebab, alone
  });

  it('tapping one applies it and takes the chip away', async () => {
    answerFor('that was the school thing', {
      ...SAMPLE_CODING,
      effects: [{ type: 'claimEvent', eventId: 'evt-1' }],
    });

    render(<PulseView />);
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'that was the school thing' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    fireEvent.click(await screen.findByText('claim event'));

    await waitFor(() => expect(screen.queryByText('claim event')).toBeNull());
    expect((await getPulses())[0].links?.eventId).toBe('evt-1');
  });

  it('dismissing one drops the effect and keeps the coding', async () => {
    const LINE = 'that was the school thing';
    answerFor(LINE, {
      ...SAMPLE_CODING,
      signal: 'claim',
      effects: [{ type: 'claimEvent', eventId: 'evt-1' }],
    });

    render(<PulseView />);
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;
    fireEvent.change(box, { target: { value: LINE } });
    fireEvent.keyDown(box, { key: 'Enter' });

    fireEvent.click(await screen.findByLabelText('dismiss claim event'));

    await waitFor(() => expect(screen.queryByText('claim event')).toBeNull());
    expect((await getPulses())[0].links?.eventId ?? null).toBeNull();

    // The line is still coded: the dot stays filled and the signal is still there.
    const line = screen.getByText(LINE);
    expect(line.closest('li')?.querySelector('[aria-hidden="true"]')).toHaveClass('bg-text-muted');
    const rows = await getPulses();
    expect(rows).toHaveLength(1);
    expect(rows[0].signal).toBe('claim');
  });

  it('approves a vocabulary proposal on a tap, and it has no other way in', async () => {
    answerFor('pruned the hedge', {
      ...SAMPLE_CODING,
      vocabProposal: { kind: 'domain', value: 'garden', mapsTo: null },
    });

    render(<PulseView />);
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'pruned the hedge' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    const chip = await screen.findByText('+ domain garden');
    // Nothing applied it while it sat there: approving is the tap and only the
    // tap. No switch is on here — that a proposal survives every switch being
    // on (Appendix C: it has no auto path at all) is pinned in pulse.test.ts,
    // which is where the switches live.
    expect(readPulseVocabRow()?.domains ?? []).not.toContain('garden');

    fireEvent.click(chip);

    await waitFor(() => expect(readPulseVocabRow()?.domains).toContain('garden'));
    expect(screen.queryByText('+ domain garden')).toBeNull();
  });
});
