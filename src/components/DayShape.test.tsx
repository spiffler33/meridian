/**
 * The day-shape strip.
 *
 * What matters on screen is the ordering and the muting: all-day facts first,
 * then the day in clock order, with what is behind you receding and exactly
 * one thing lit. Those are the reasons to look at it at all, so they are what
 * this asserts — along with the two states that must never be silent, an empty
 * day and a mirror that has stopped updating.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DayShape } from './DayShape';
import type { CalendarMirror } from '../lib/calendar';

const SGT = 'Asia/Singapore';
const DATE = '2026-08-27';

/** 12:00 SGT on the day under test, inside the hours the mirror runs. */
const NOON = Date.parse('2026-08-27T04:00:00Z');

function mirrorOf(events: CalendarMirror['events'], generatedAt = NOON): CalendarMirror {
  return { generatedAt, window: { start: '', end: '' }, calendars: ['home'], events };
}

const STANDUP = {
  id: 'a',
  calendar: 'home',
  title: 'standup',
  start: '2026-08-27T01:30:00Z', // 09:30 SGT
  end: '2026-08-27T02:00:00Z',
  allDay: false,
  location: null,
};

const CALL = {
  id: 'b',
  calendar: 'db',
  title: 'db call',
  start: '2026-08-27T06:00:00Z', // 14:00 SGT
  end: '2026-08-27T07:00:00Z',
  allDay: false,
  location: 'level 12',
};

const TRIP = {
  id: 'c',
  calendar: 'personal',
  title: 'trip',
  start: '2026-08-27',
  end: '2026-08-28',
  allDay: true,
  location: null,
};

describe('the strip', () => {
  it('puts all-day facts before the clock', () => {
    const { container } = render(
      <DayShape mirror={mirrorOf([CALL, TRIP, STANDUP])} date={DATE} timeZone={SGT} now={NOON} />
    );

    const text = container.textContent ?? '';
    expect(text.indexOf('trip')).toBeLessThan(text.indexOf('standup'));
    expect(text.indexOf('standup')).toBeLessThan(text.indexOf('db call'));
  });

  it('shows each event as a local clock range', () => {
    render(<DayShape mirror={mirrorOf([STANDUP])} date={DATE} timeZone={SGT} now={NOON} />);

    expect(screen.getByText('09:30–10:00')).toBeInTheDocument();
  });

  it('mutes what is already over and lights what is next', () => {
    render(
      <DayShape mirror={mirrorOf([STANDUP, CALL])} date={DATE} timeZone={SGT} now={NOON} />
    );

    // 12:00: standup finished at 10:00, the call has not started.
    expect(screen.getByText('standup').className).toContain('text-text-muted');
    expect(screen.getByText('db call').className).toContain('text-text');
  });

  it('lights nothing once the day is done', () => {
    const evening = Date.parse('2026-08-27T14:00:00Z');

    render(
      <DayShape mirror={mirrorOf([STANDUP, CALL])} date={DATE} timeZone={SGT} now={evening} />
    );

    expect(screen.getByText('standup').className).toContain('text-text-muted');
    expect(screen.getByText('db call').className).toContain('text-text-muted');
  });

  it('shows a location where there is one and adds nothing where there is not', () => {
    render(
      <DayShape mirror={mirrorOf([STANDUP, CALL])} date={DATE} timeZone={SGT} now={NOON} />
    );

    expect(screen.getByText('level 12')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('leaves out the events that belong to another day', () => {
    const tomorrow = {
      ...STANDUP,
      id: 'z',
      title: 'tomorrow',
      start: '2026-08-28T01:30:00Z',
      end: '2026-08-28T02:00:00Z',
    };

    render(
      <DayShape mirror={mirrorOf([STANDUP, tomorrow])} date={DATE} timeZone={SGT} now={NOON} />
    );

    expect(screen.queryByText('tomorrow')).not.toBeInTheDocument();
  });
});

describe('what the strip says when there is nothing to show', () => {
  it('states an empty day rather than raising an alarm about it', () => {
    render(<DayShape mirror={mirrorOf([])} date={DATE} timeZone={SGT} now={NOON} />);

    expect(screen.getByText('no events mirrored today')).toBeInTheDocument();
  });

  it('says the same with no mirror at all, without throwing', () => {
    render(<DayShape mirror={null} date={DATE} timeZone={SGT} now={NOON} />);

    expect(screen.getByText('no events mirrored today')).toBeInTheDocument();
  });
});

describe('the stale note', () => {
  it('names the time the mirror was last written', () => {
    // Written at 09:30 SGT, read at noon: three missed runs.
    const written = Date.parse('2026-08-27T01:30:00Z');

    render(
      <DayShape mirror={mirrorOf([STANDUP], written)} date={DATE} timeZone={SGT} now={NOON} />
    );

    expect(screen.getByText('mirror stale since 09:30')).toBeInTheDocument();
  });

  it('stays quiet while the mirror is keeping up', () => {
    render(<DayShape mirror={mirrorOf([STANDUP])} date={DATE} timeZone={SGT} now={NOON} />);

    expect(screen.queryByText(/mirror stale/)).not.toBeInTheDocument();
  });
});
