/**
 * Energy, as the owner reads it.
 *
 * `ledger.test.ts` pins the arithmetic; this pins that the right arithmetic
 * reaches the screen, and that the two things this section could quietly lie
 * about do not happen: an unclaimed home hour drawn as the owner's, and a
 * calendar paired against a domain that only looks like it.
 *
 * The zone is mocked rather than inherited. `deviceTimeZone()` reads the
 * machine, so a week boundary computed from it would put these fixtures in
 * different weeks on a laptop in Singapore and one in California, and the
 * suite would pass or fail by geography.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { CalendarEvent, CalendarMirror } from '../lib/calendar';
import type { PulseRow, PulseSignal } from '../lib/entities';

const mocks = vi.hoisted(() => ({
  pulses: [] as PulseRow[],
}));

// The stream and nothing else. Energy stopped reading habits and the vocabulary
// in phase 4, and mocking what it no longer touches would hide a regression
// rather than prevent one.
vi.mock('../services/data', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/data')>()),
  getPulses: async () => mocks.pulses,
}));

vi.mock('../lib/calendar', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/calendar')>()),
  deviceTimeZone: () => 'Asia/Singapore',
}));

const { EnergySection } = await import('./EnergySection');

/** Wednesday of the SGT week Mon 2026-08-24 through Sun 2026-08-30. */
const IN_WEEK = '2026-08-26';

function coded(id: string, signal: PulseSignal, start: string, extra: Partial<PulseRow> = {}): PulseRow {
  return {
    id,
    text: id,
    at: start,
    signal,
    domain: null,
    activity: null,
    people: [],
    span: { start, end: null, approx: false },
    links: { eventId: null },
    ...extra,
  };
}

function block(id: string, domain: string, start: string, end: string): PulseRow {
  return coded(id, 'block', start, { domain, span: { start, end, approx: false } });
}

function timed(id: string, calendar: string, start: string, end: string): CalendarEvent {
  return { id, calendar, title: id, start, end, allDay: false, location: null };
}

function mirrorOf(events: CalendarEvent[]): CalendarMirror {
  return { generatedAt: 0, window: { start: '', end: '' }, calendars: [], events };
}

const noop = () => {};

function show(props: Partial<Parameters<typeof EnergySection>[0]> = {}) {
  return render(
    <EnergySection
      mirror={null}
      selectedDate={IN_WEEK}
      weekStartsOn={1}
      onPreviousWeek={noop}
      onNextWeek={noop}
      {...props}
    />
  );
}

beforeEach(() => {
  mocks.pulses = [];
});

afterEach(cleanup);

describe('the energy section', () => {
  it('says the empty week once, rather than four ways of saying the same thing', async () => {
    show();
    expect(await screen.findByText('nothing coded this week')).toBeInTheDocument();
    // A sub-section with nothing in it is not drawn at all — not its label,
    // and not an apology under it.
    expect(screen.queryByText('spent by domain')).toBeNull();
    expect(screen.queryByText('needed by calendar')).toBeNull();
    expect(screen.queryByText('calories by day')).toBeNull();
    expect(screen.queryByText('activity timing')).toBeNull();
  });

  it("draws the week's hours by domain, with the number outside the bar", async () => {
    mocks.pulses = [
      block('a', 'db', '2026-08-24T01:00:00.000Z', '2026-08-24T03:00:00.000Z'),
      block('b', 'self', '2026-08-25T01:00:00.000Z', '2026-08-25T02:00:00.000Z'),
    ];
    show();
    expect(await screen.findByTitle('db')).toBeInTheDocument();
    expect(screen.getByTitle('self')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.getByText('1.0')).toBeInTheDocument();
  });

  it('counts nothing from another week', async () => {
    mocks.pulses = [block('a', 'db', '2026-08-17T01:00:00.000Z', '2026-08-17T03:00:00.000Z')];
    show();
    expect(await screen.findByText('nothing coded this week')).toBeInTheDocument();
    expect(screen.queryByText('spent by domain')).toBeNull();
  });

  it('shows an unclaimed home hour as zero, and says how many were not claimed', async () => {
    const mirror = mirrorOf([
      timed('evt-home', 'home', '2026-08-25T01:00:00.000Z', '2026-08-25T03:00:00.000Z'),
    ]);
    show({ mirror });
    expect(await screen.findByTitle('home')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByTitle('2.0 h unclaimed')).toBeInTheDocument();
  });

  it('bills the same home hour once a pulse claims the event', async () => {
    mocks.pulses = [
      coded('claim', 'claim', '2026-08-25T04:00:00.000Z', {
        links: { eventId: 'evt-home' },
      }),
    ];
    const mirror = mirrorOf([
      timed('evt-home', 'home', '2026-08-25T01:00:00.000Z', '2026-08-25T03:00:00.000Z'),
    ]);
    show({ mirror });
    expect(await screen.findByTitle('home')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.queryByTitle(/unclaimed/)).not.toBeInTheDocument();
  });

  it('compares needed against spent only where the two names are the same word', async () => {
    mocks.pulses = [
      block('a', 'db', '2026-08-24T01:00:00.000Z', '2026-08-24T03:00:00.000Z'),
      block('b', 'self', '2026-08-25T01:00:00.000Z', '2026-08-25T02:00:00.000Z'),
    ];
    const mirror = mirrorOf([
      timed('evt-db', 'db', '2026-08-25T01:00:00.000Z', '2026-08-25T04:00:00.000Z'),
      timed('evt-p', 'personal', '2026-08-26T01:00:00.000Z', '2026-08-26T02:00:00.000Z'),
    ]);
    show({ mirror });
    expect(await screen.findByText('needed vs spent')).toBeInTheDocument();
    expect(screen.getByTitle('db needed')).toBeInTheDocument();
    expect(screen.getByTitle('db spent')).toBeInTheDocument();
    // `self` and `personal` are each in exactly one chart and never paired.
    expect(screen.queryByTitle('self spent')).not.toBeInTheDocument();
    expect(screen.queryByTitle('personal needed')).not.toBeInTheDocument();
  });

  it('draws no comparison at all when nothing pairs cleanly', async () => {
    mocks.pulses = [block('a', 'self', '2026-08-24T01:00:00.000Z', '2026-08-24T03:00:00.000Z')];
    const mirror = mirrorOf([
      timed('evt', 'personal', '2026-08-25T01:00:00.000Z', '2026-08-25T02:00:00.000Z'),
    ]);
    show({ mirror });
    expect(await screen.findByTitle('self')).toBeInTheDocument();
    expect(screen.queryByText('needed vs spent')).not.toBeInTheDocument();
  });

  it('counts the pulses the coder never reached, and stays silent at zero', async () => {
    mocks.pulses = [
      { id: 'u1', text: 'u', at: '2026-08-25T01:00:00.000Z' },
      { id: 'u2', text: 'u', at: '2026-08-25T02:00:00.000Z' },
    ];
    show();
    expect(await screen.findByText('2 uncoded pulses excluded')).toBeInTheDocument();

    cleanup();
    mocks.pulses = [block('a', 'db', '2026-08-24T01:00:00.000Z', '2026-08-24T03:00:00.000Z')];
    show();
    expect(await screen.findByTitle('db')).toBeInTheDocument();
    expect(screen.queryByText(/uncoded/)).not.toBeInTheDocument();
  });

  it('plots an activity in the device zone, by the hour its span started', async () => {
    // 23:30 UTC is 07:30 the next morning in Singapore — the zone the mock
    // pins, so this reads the same on any machine.
    mocks.pulses = [
      coded('g', 'block', '2026-08-24T23:30:00.000Z', { activity: 'gym' }),
      coded('g2', 'block', '2026-08-25T23:30:00.000Z', { activity: 'gym' }),
      coded('r', 'block', '2026-08-25T14:00:00.000Z', { activity: 'read' }),
    ];

    show();

    expect(await screen.findByLabelText('gym: 2 logged')).toBeInTheDocument();
    expect(screen.getByTitle('07:00 - 2')).toBeInTheDocument();
    expect(screen.getByLabelText('read: 1 logged')).toBeInTheDocument();
    // No footnote: nothing was left out.
    expect(screen.queryByText(/not shown/)).toBeNull();
  });

  it('reaches twelve weeks back, not just the week the stepper is on', async () => {
    // Nine weeks before the selected week: outside every other chart on this
    // page, inside this one.
    mocks.pulses = [coded('old', 'block', '2026-06-22T23:30:00.000Z', { activity: 'gym' })];

    show();

    expect(await screen.findByLabelText('gym: 1 logged')).toBeInTheDocument();
  });

  it('says how many quieter activities it did not draw', async () => {
    mocks.pulses = Array.from({ length: 11 }, (_, index) =>
      coded(`p${index}`, 'block', '2026-08-25T01:00:00.000Z', { activity: `activity-${index}` })
    );

    show();

    expect(await screen.findByText('3 quieter activities not shown')).toBeInTheDocument();
  });

  it('steps the week through the same handlers the lens above it uses', async () => {
    const onPreviousWeek = vi.fn();
    const onNextWeek = vi.fn();
    show({ onPreviousWeek, onNextWeek });
    fireEvent.click(await screen.findByLabelText('previous week'));
    fireEvent.click(screen.getByLabelText('next week'));
    expect(onPreviousWeek).toHaveBeenCalledTimes(1);
    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });
});

/**
 * The weekly calorie bars (phase 5).
 *
 * `ledger.test.ts` pins the sums; what is pinned here is that the drawing
 * does not lie about them. Three ways it could: a value printed inside the
 * bar disappears on the short days, an estimated share drawn as its own bar
 * double-counts a day, and a week's uncounted items vanishing entirely would
 * make a week that lost three meals read as a light one.
 */
describe('calories by day', () => {
  /** A pulse that says the owner ate something. Wednesday of the SGT week under test. */
  function ate(id: string, at: string, nutrition: PulseRow['nutrition']): PulseRow {
    return coded(id, 'note', at, { nutrition });
  }

  it('draws a bar per day with its total OUTSIDE the bar, so a short day still reads', async () => {
    mocks.pulses = [
      ate('mon', '2026-08-24T04:00:00.000Z', { kcal: 2100, kcalSource: 'stated' }),
      ate('wed', '2026-08-26T04:00:00.000Z', { kcal: 640, kcalSource: 'estimated' }),
    ];

    show();

    expect(await screen.findByText('calories by day')).toBeInTheDocument();
    expect(screen.getByText('2,100')).toBeInTheDocument();
    // The short day. Inside a bar this width it would be invisible.
    expect(screen.getByText('640')).toBeInTheDocument();
    // Seven rows, empty days included: the shape of the week is the point.
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
  });

  it('marks a day\'s estimated share without adding it to the day again', async () => {
    mocks.pulses = [
      ate('stated', '2026-08-26T04:00:00.000Z', { kcal: 400, kcalSource: 'stated' }),
      ate('guessed', '2026-08-26T06:00:00.000Z', { kcal: 600, kcalSource: 'estimated' }),
    ];

    show();

    // One bar of 1,000, not a 400 and a 600 — an estimated calorie is still a
    // counted calorie, and the fainter segment is a share OF the bar.
    expect(await screen.findByText('1,000')).toBeInTheDocument();
    expect(screen.queryByText('600')).not.toBeInTheDocument();
    expect(screen.getByTitle('600 kcal estimated')).toBeInTheDocument();
  });

  it('draws a corrected day single-tone, with no estimate marker at all', async () => {
    mocks.pulses = [
      ate('guessed', '2026-08-26T04:00:00.000Z', { kcal: 1220, kcalSource: 'estimated' }),
      // The owner, the next day, saying what Wednesday actually came to.
      coded('fix', 'note', '2026-08-27T04:00:00.000Z', {
        corrections: [{ date: '2026-08-26', kcal: 2400 }],
      }),
    ];

    show();

    expect(await screen.findByText('2,400')).toBeInTheDocument();
    // The number came from the owner, so there is no share of it resting on a
    // guess and nothing for the second tone to separate.
    expect(screen.queryByTitle(/estimated/)).not.toBeInTheDocument();
    expect(screen.queryByText('1,220')).not.toBeInTheDocument();
  });

  it('footnotes the week\'s uncounted items, so a week that lost meals does not read as a light one', async () => {
    mocks.pulses = [
      ate('buffet', '2026-08-26T04:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
      ate('party', '2026-08-28T04:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
    ];

    show();

    expect(await screen.findByText('2 items eaten, not counted')).toBeInTheDocument();
  });

  it('draws no calorie block at all when nothing eaten was logged, rather than seven empty bars', async () => {
    mocks.pulses = [block('work', 'db', '2026-08-26T01:00:00.000Z', '2026-08-26T03:00:00.000Z')];

    show();

    // The week is not empty — the hours are drawn — but the food half of it is,
    // and an empty sub-section is left out rather than apologised for.
    expect(await screen.findByText('spent by domain')).toBeInTheDocument();
    expect(screen.queryByText('calories by day')).toBeNull();
    expect(screen.queryByText('nothing coded this week')).toBeNull();
  });
});
