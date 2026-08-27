/**
 * Reading in the year heatmap, and the week that hangs off it.
 *
 * The smallest honest integration: a day something was read on is a day with
 * activity on it, so it comes off the floor. The heatmap still measures habits
 * and is not being redesigned around a second scale — what is tested here is
 * that the wiring uses the same `YYYY-MM-DD` key the calendar does, because a
 * key that did not match would light nothing and say nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { createEmptyDailyData } from '../types';
import { YearView } from './YearView';

const readDays = vi.hoisted(() => ({ days: new Set<string>() }));

vi.mock('../hooks/useReadState', () => ({
  useReadState: () => ({
    isRead: () => false,
    toggle: vi.fn(),
    unread: () => null,
    spent: () => false,
    days: readDays.days,
  }),
}));

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    state: { settings: { habits: [{ id: 'h1', label: 'Read', category: 'learning' }], weekStartsOn: 1 } },
    getHabitCount: () => 0,
    getDailyData: () => createEmptyDailyData('2026-03-04'),
    getHabitStreak: () => 0,
    getYearTheme: () => '',
    setYearTheme: vi.fn(),
    profile: null,
    updateProfile: vi.fn(),
  }),
}));

afterEach(() => {
  readDays.days = new Set();
  cleanup();
});

function show(weekOpen = false): void {
  render(
    <YearView
      selectedYear={2026}
      onYearChange={vi.fn()}
      onDateSelect={vi.fn()}
      mirror={null}
      selectedDate="2026-03-04"
      weekOpen={weekOpen}
      onWeekOpenChange={vi.fn()}
      onPreviousWeek={vi.fn()}
      onNextWeek={vi.fn()}
    />
  );
}

describe('a day something was read on', () => {
  it('comes off the floor even with no habit ticked', () => {
    readDays.days = new Set(['2026-03-04']);
    show();

    const lit = screen.getByTitle(/read$/);
    expect(lit.className).toContain('heat-1');
    expect(lit.className).not.toContain('heat-0');
  });

  it("says so in the day's own label, rather than lighting for no reason", () => {
    readDays.days = new Set(['2026-03-04']);
    show();

    expect(screen.getByTitle(/· read$/)).toBeInTheDocument();
    // Exactly one day was read; nothing else claims to have been.
    expect(screen.getAllByTitle(/· read$/)).toHaveLength(1);
  });

  it('leaves every other day exactly as the habits left it', () => {
    readDays.days = new Set();
    show();

    expect(screen.queryByTitle(/· read$/)).not.toBeInTheDocument();
    expect(screen.getAllByTitle(/0\/1$/).length).toBeGreaterThan(300);
  });
});

/**
 * The week is a lens now, not a place.
 *
 * Closed is the default and the whole point: the year opens as the year, with
 * the week available as one line of arithmetic above it. `w` is what opens it,
 * which is why the flag is held above this view rather than inside it.
 */
describe('the week lens', () => {
  it('opens closed, saying only what the week amounts to', () => {
    show();

    const lens = screen.getByRole('button', { name: /this week/ });
    expect(lens).toHaveAttribute('aria-expanded', 'false');
    expect(lens.textContent).toContain('tasks 0/0');
    expect(screen.queryByText('tasks completed: 0/0')).toBeNull();
  });

  it('renders the week itself when it is open', () => {
    show(true);

    expect(screen.getByRole('button', { name: /this week/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText('tasks completed: 0/0')).toBeInTheDocument();
  });
});
