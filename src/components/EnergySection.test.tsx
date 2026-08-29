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
  it('says what it has nothing of rather than drawing an empty frame', async () => {
    show();
    expect(await screen.findByText('no coded blocks this week')).toBeInTheDocument();
    expect(screen.getByText('no events this week')).toBeInTheDocument();
    expect(screen.getByText('nothing coded to an activity yet')).toBeInTheDocument();
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
    expect(await screen.findByText('no coded blocks this week')).toBeInTheDocument();
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
