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
 * The real `AppProvider` wraps every render, as `TowerView.test.tsx` does it
 * and for the same reason: the profile is app state, the phase 5 calorie line
 * reads a field off it, and a stubbed context would prove nothing about the
 * wiring between a profile write and what the line prints.
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
vi.mock('../lib/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sync')>();
  return { ...actual, scheduleFlush: scheduleFlushMock };
});

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
import { AppProvider } from '../store/AppContext';
import { getPulses, updateProfile } from '../services/data';
import { getToday } from '../utils/dates';
import { CODER_REV } from '../services/coder';
import type { Coding } from '../services/coder';

const NOW = new Date('2026-08-27T12:00:00.000Z');

function renderPulse() {
  render(
    <AppProvider>
      <PulseView />
    </AppProvider>
  );
}

const SAMPLE_CODING: Coding = {
  signal: 'note',
  domain: null,
  activity: null,
  people: [],
  span: { start: '2026-08-27T12:00:00.000Z', end: null, approx: false },
  links: { eventId: null },
  nutrition: null,
  corrections: [],
  coderRev: CODER_REV,
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
    renderPulse();

    expect(await screen.findByLabelText('capture a pulse')).toHaveFocus();
  });

  it('escape blurs it', async () => {
    renderPulse();
    const box = await screen.findByLabelText('capture a pulse');
    expect(box).toHaveFocus();

    fireEvent.keyDown(box, { key: 'Escape' });

    expect(box).not.toHaveFocus();
  });
});

describe('capture', () => {
  it('renders optimistically, clears the field, and reuses the outbox/flush path', async () => {
    renderPulse();
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
    renderPulse();
    const box = await screen.findByLabelText('capture a pulse');
    // Cleared after mount: `AppProvider` pushes on its own startup writes, and
    // the claim under test is about what the EMPTY ENTER did, not about what
    // the page did to come up.
    scheduleFlushMock.mockClear();

    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await outboxSize()).toBe(0);
    expect(scheduleFlushMock).not.toHaveBeenCalled();
  });
});

describe('the coding dot', () => {
  it('is hollow for an uncoded pulse, and stays hollow when the coder has nothing to offer', async () => {
    renderPulse();
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

    renderPulse();
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

    renderPulse();
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

    renderPulse();
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

    renderPulse();
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

    renderPulse();
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

/**
 * The nutrition line (phase 5): an instrument, not a message.
 *
 * What is pinned is what it PRINTS, not how it is styled — the four numbers,
 * the parts that disappear rather than showing a zero, and the target that
 * only appears when the owner has set one. And that it says nothing else:
 * fence 6 is a claim about the words on the screen, and this is the screen.
 */
describe('the nutrition line', () => {
  /**
   * What the coder will answer, by the line it is asked about.
   *
   * One implementation for the whole test, registered before any capture.
   * Coding is fired and not awaited (fence 3), so a call for the FIRST line
   * can still be in flight when the second is typed — and a mock reassigned
   * per capture would answer that late call with the wrong line's food, or
   * with null.
   */
  const menu = new Map<string, Pick<Coding, 'nutrition' | 'corrections'> & { span?: Coding['span'] }>();

  /**
   * A minute after the frozen clock, and the same local day in every zone:
   * only a device sitting exactly on a midnight between `NOW` and `NOW + 1m`
   * could disagree, and no offset puts one there.
   *
   * The coder's span is what says when food was EATEN, and the fixture's is
   * `NOW` — so a meal that has to land after a waterline needs its own.
   */
  const A_MINUTE_LATER: Coding['span'] = {
    start: new Date(NOW.getTime() + 60_000).toISOString(),
    end: null,
    approx: false,
  };

  beforeEach(() => {
    menu.clear();
    codePulseMock.mockImplementation(async (captured: string) => {
      const answer = menu.get(captured);
      return answer === undefined ? null : { ...SAMPLE_CODING, ...answer };
    });
  });

  /** One pulse asserting a day's total, captured through the real path. */
  async function captureCorrection(text: string, corrections: Coding['corrections']): Promise<void> {
    menu.set(text, { nutrition: null, corrections });
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Enter' });
    const line = await screen.findByText(text);
    const row = line.closest('li');
    await waitFor(() => expect(row?.querySelector('.bg-text-muted')).not.toBeNull());
  }

  /** One coded pulse carrying nutrition, captured through the real path. */
  async function captureFood(
    text: string,
    nutrition: Coding['nutrition'],
    span?: Coding['span']
  ): Promise<void> {
    // Set only when given: an explicit `span: undefined` would spread OVER the
    // fixture's span and leave the pulse with none at all.
    menu.set(text, span === undefined ? { nutrition, corrections: [] } : { nutrition, corrections: [], span });
    const box = (await screen.findByLabelText('capture a pulse')) as HTMLInputElement;
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Enter' });
    // The line renders optimistically; the dot fills only once the coding has
    // landed and the list has been re-read, which is what the totals read.
    const line = await screen.findByText(text);
    const row = line.closest('li');
    await waitFor(() => expect(row?.querySelector('.bg-text-muted')).not.toBeNull());
  }

  it('is absent on a day with no food logged — an empty instrument is not a fact', async () => {
    renderPulse();
    await screen.findByLabelText('capture a pulse');

    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('prints one number, whatever that number is made of', async () => {
    renderPulse();
    await captureFood('620 kcal burrito', { kcal: 620, kcalSource: 'stated', proteinG: 42, proteinSource: 'stated' });
    await captureFood('two eggs on toast', { kcal: 300, kcalSource: 'estimated', proteinG: 18, proteinSource: 'estimated' });

    // 920 counted, 300 of it estimated, 60 g of protein between them — and the
    // line says none of that. How much of a total rests on a guess is a
    // question asked while reviewing a week, and Energy's bars answer it there.
    expect(await screen.findByText('920 kcal')).toBeInTheDocument();
    expect(screen.queryByText(/est/)).not.toBeInTheDocument();
    expect(screen.queryByText(/protein/)).not.toBeInTheDocument();
  });

  it('marks the total with a + when something eaten could not be counted', async () => {
    renderPulse();
    await captureFood('620 kcal burrito', { kcal: 620, kcalSource: 'stated' });
    await captureFood('ate something at the buffet', { kcal: null, kcalSource: 'estimated' });

    // Dropping the unsizeable meal outright would make the line lie: this is
    // not the day a bare 620 describes. One character, and no word to decode.
    expect(await screen.findByText('620+ kcal')).toBeInTheDocument();
    expect(screen.queryByText(/uncounted/)).not.toBeInTheDocument();
  });

  it('drops the estimated and uncounted parts when there are none, rather than printing zeros', async () => {
    renderPulse();
    await captureFood('620 kcal burrito', { kcal: 620, kcalSource: 'stated' });

    // "0 uncounted" is noise on the ordinary day, and the tally only means
    // something because it is unusual enough to notice.
    expect(await screen.findByText('620 kcal')).toBeInTheDocument();
    expect(screen.queryByText(/est/)).not.toBeInTheDocument();
    expect(screen.queryByText(/uncounted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/protein/)).not.toBeInTheDocument();
  });

  it('takes the owner\'s stated total, and keeps counting what they eat after it', async () => {
    renderPulse();
    await captureFood('two eggs on toast', { kcal: 300, kcalSource: 'estimated' });
    await captureFood('ate something at the buffet', { kcal: null, kcalSource: 'estimated' });
    expect(await screen.findByText('300+ kcal')).toBeInTheDocument();

    // The owner reads that and says what the day has come to so far. The
    // estimate and the unsizeable meal are both subsumed by their number, and
    // the `+` goes with them: nothing uncounted is left outside it.
    const today = getToday();
    await captureCorrection('today was 2200', [{ date: today, kcal: 2200 }]);
    expect(await screen.findByText('2,200 kcal')).toBeInTheDocument();

    // Then they eat again. The correction was a waterline and not a lid, so
    // the tofu lands on top of it. Read as a lid — which is how this shipped —
    // the line stayed at 2,200 for the rest of the day with nothing on screen
    // to say why, and every meal after lunch was silently discarded.
    await captureFood('100 cals worth of tofu', { kcal: 100, kcalSource: 'stated' }, A_MINUTE_LATER);
    expect(await screen.findByText('2,300 kcal')).toBeInTheDocument();
  });

  it('appends the target only when the owner has set one, as a plain number', async () => {
    renderPulse();
    await captureFood('620 kcal burrito', { kcal: 620, kcalSource: 'stated' });
    expect(await screen.findByText('620 kcal')).toBeInTheDocument();

    cleanup();
    await updateProfile({ kcal_target: 1800 });
    resetSession();
    renderPulse();

    // A number beside a number. No comparison, no verdict, no colour that
    // changes with the total, and nothing about the gap (fence 6).
    const line = await screen.findByText('620 kcal · of 1,800');
    expect(line).toBeInTheDocument();
    expect(line.textContent).not.toMatch(/over|under|left|remaining|good|goal/i);
  });
});
