/**
 * The week's event lanes.
 *
 * A day card is a glance, so the lane has a cap and says how much it is not
 * showing — a card that silently dropped the sixth meeting would read as a
 * lighter day than it is. The other thing worth asserting is the muting: a
 * week is mostly days that are over, and they have to recede or the card you
 * are actually planning does not stand out.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { WeekView } from './WeekView';
import { getWeekDates } from '../utils/dates';
import type { CalendarEvent, CalendarMirror } from '../lib/calendar';

vi.mock('../components/AiInsight', () => ({ AiInsight: () => null }));

// The view reads the device's zone, and which local day a UTC instant lands on
// depends on it. Pinned to UTC so the assertions below mean the same thing on
// a laptop in Singapore and on a CI runner in California.
vi.mock('../lib/calendar', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/calendar')>()),
  deviceTimeZone: () => 'UTC',
}));

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    state: {
      settings: { habits: [], weekStartsOn: 1 },
      dailyData: {},
    },
    getDailyData: () => ({
      mit: { work: [], self: [], family: [] },
      habits: [],
      reflection: '',
    }),
    getHabitCount: () => 0,
    getHabitStreak: () => 0,
  }),
}));

afterEach(cleanup);

/** Far enough back and forward that the real clock cannot land inside either. */
const PAST_WEEK = '2026-01-14';
const FUTURE_WEEK = '2099-01-14';

const timed = (id: string, date: string, hour: string): CalendarEvent => ({
  id,
  calendar: 'home',
  title: id,
  start: `${date}T${hour}:00:00Z`,
  end: `${date}T${hour}:30:00Z`,
  allDay: false,
  location: null,
});

function mirrorOf(events: CalendarEvent[]): CalendarMirror {
  return { generatedAt: 0, window: { start: '', end: '' }, calendars: ['home'], events };
}

function view(week: string, mirror: CalendarMirror) {
  return render(
    <WeekView
      mirror={mirror}
      selectedDate={week}
      onDateSelect={() => undefined}
      onPreviousWeek={() => undefined}
      onNextWeek={() => undefined}
    />
  );
}

describe('the lane on a day card', () => {
  const week = getWeekDates(FUTURE_WEEK, 1);

  it('stops at five and says how many it did not show', () => {
    const day = week[2];
    const events = ['01', '02', '03', '04', '05', '06', '07'].map((hour, index) =>
      timed(`meeting-${index}`, day, hour)
    );

    view(FUTURE_WEEK, mirrorOf(events));

    expect(screen.getByText('meeting-4')).toBeInTheDocument();
    expect(screen.queryByText('meeting-5')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('counts nothing extra when the day fits', () => {
    view(FUTURE_WEEK, mirrorOf([timed('one', week[2], '01')]));

    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });

  it('shows an all-day event with no clock on it', () => {
    const day = week[3];
    const span: CalendarEvent = {
      id: 'trip',
      calendar: 'personal',
      title: 'trip',
      start: day,
      end: week[5],
      allDay: true,
      location: null,
    };

    view(FUTURE_WEEK, mirrorOf([span]));

    // On all three days it covers, and never with a time.
    expect(screen.getAllByText('trip')).toHaveLength(2);
  });

  it('puts each event on its own day and nowhere else', () => {
    view(FUTURE_WEEK, mirrorOf([timed('monday', week[0], '01'), timed('friday', week[4], '01')]));

    expect(screen.getAllByText('monday')).toHaveLength(1);
    expect(screen.getAllByText('friday')).toHaveLength(1);
  });
});

describe('muting', () => {
  it('recedes every day of a week that is over', () => {
    const week = getWeekDates(PAST_WEEK, 1);

    view(PAST_WEEK, mirrorOf([timed('done', week[2], '01')]));

    expect(screen.getByText('done').className).toContain('text-text-muted');
  });

  it('leaves a week that has not happened at full strength', () => {
    const week = getWeekDates(FUTURE_WEEK, 1);

    view(FUTURE_WEEK, mirrorOf([timed('ahead', week[2], '01')]));

    expect(screen.getByText('ahead').className).not.toContain('text-text-muted');
  });
});

describe('a week with no mirror', () => {
  it('renders the cards as it always did', () => {
    view(FUTURE_WEEK, mirrorOf([]));

    expect(screen.getAllByText('tasks').length).toBe(7);
  });
});
