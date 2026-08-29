/**
 * Year View
 *
 * Heatmap of habit completion. Terminal-style stats.
 *
 * The year is one of the two poles the app is lived at, so the week hangs off
 * it as a lens rather than standing beside it as a place. Collapsed, it is one
 * line of arithmetic; open, it is the whole week view, unchanged.
 */

import { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { useReadState } from '../hooks/useReadState';
import { WeekView } from './WeekView';
import { EnergySection } from '../components/EnergySection';
import { Section } from '../components/Section';
import { StepNav } from '../components/StepNav';
import { weekTotals } from '../utils/weekTotals';
import type { CalendarMirror } from '../lib/calendar';
import { getYearCalendarGrid, formatShortDate, getMonthAbbr, getWeekDates, getWeekNumber, isToday, isFuture, parseDate } from '../utils/dates';

interface YearViewProps {
  selectedYear: number;
  onYearChange: (year: number) => void;
  onDateSelect: (date: string) => void;
  mirror: CalendarMirror | null;
  selectedDate: string;
  /** Held above this view so `w` can open the lens from anywhere. */
  weekOpen: boolean;
  onWeekOpenChange: (open: boolean) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
}

function getHeatLevel(habitCount: number, totalHabits: number): number {
  if (habitCount === 0) return 0;
  const pct = habitCount / totalHabits;
  if (pct >= 1) return 5;
  if (pct >= 0.7) return 4;
  if (pct >= 0.5) return 3;
  if (pct >= 0.3) return 2;
  return 1;
}

const HEAT_COLORS = ['heat-0', 'heat-1', 'heat-2', 'heat-3', 'heat-4', 'heat-5'];

interface DayCellProps {
  date: string;
  habitCount: number;
  totalHabits: number;
  /** Something in the reading corpus was marked read on this day. */
  didRead: boolean;
  onClick: () => void;
}

function DayCell({ date, habitCount, totalHabits, didRead, onClick }: DayCellProps) {
  // Reading is a day's activity like a habit tick is. It lifts an otherwise
  // blank day off the floor and stops there: the heatmap measures habits and
  // is not being redesigned around a second scale.
  const heatLevel = Math.max(getHeatLevel(habitCount, totalHabits), didRead ? 1 : 0);
  const today = isToday(date);
  const future = isFuture(date);

  return (
    <button
      onClick={onClick}
      className={`
        w-3 h-3 rounded-sm transition-colors hover:ring-1 hover:ring-accent
        ${HEAT_COLORS[heatLevel]}
        ${today ? 'ring-1 ring-accent' : ''}
        ${future ? 'opacity-30' : ''}
      `}
      title={`${formatShortDate(date)}: ${habitCount}/${totalHabits}${didRead ? ' · read' : ''}`}
    />
  );
}

export function YearView({
  selectedYear,
  onYearChange,
  onDateSelect,
  mirror,
  selectedDate,
  weekOpen,
  onWeekOpenChange,
  onPreviousWeek,
  onNextWeek,
}: YearViewProps) {
  const { state, getDailyData, getHabitCount, getYearTheme, setYearTheme } = useApp();
  const [editingTheme, setEditingTheme] = useState(false);
  // Seeded when the edit button is pressed rather than mirrored by an effect:
  // the field only exists while editing, so the year's theme is read at the one
  // moment it is about to be edited and never has to be kept in step.
  const [themeInput, setThemeInput] = useState('');

  const habits = state.settings.habits;
  const weekStartsOn = state.settings.weekStartsOn;
  const weekDates = useMemo(
    () => getWeekDates(selectedDate, weekStartsOn),
    [selectedDate, weekStartsOn]
  );
  const totals = weekTotals(weekDates, getDailyData);
  // Read-only: the baseline is the reading pane's to establish, never this
  // view's, so nothing here writes.
  const read = useReadState();

  const calendarGrid = useMemo(
    () => getYearCalendarGrid(selectedYear, weekStartsOn),
    [selectedYear, weekStartsOn]
  );

  const yearStats = useMemo(() => {
    let totalDays = 0;
    let daysWithHabits = 0;
    let perfectDays = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    const today = new Date();
    const sortedDates: string[] = [];

    calendarGrid.forEach(week => {
      week.forEach(date => {
        if (date && parseDate(date) <= today) {
          sortedDates.push(date);
        }
      });
    });

    sortedDates.forEach(date => {
      const count = getHabitCount(date);
      totalDays++;

      if (count > 0) {
        daysWithHabits++;
        tempStreak++;
        if (tempStreak > longestStreak) longestStreak = tempStreak;
      } else {
        tempStreak = 0;
      }

      if (count === habits.length && habits.length > 0) {
        perfectDays++;
      }
    });

    for (let i = sortedDates.length - 1; i >= 0; i--) {
      if (getHabitCount(sortedDates[i]) > 0) currentStreak++;
      else break;
    }

    return { totalDays, daysWithHabits, perfectDays, currentStreak, longestStreak };
  }, [calendarGrid, getHabitCount, habits.length]);

  const monthLabels = useMemo(() => {
    const labels: { month: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    calendarGrid.forEach((week, weekIndex) => {
      const firstDate = week.find(d => d !== '');
      if (firstDate) {
        const month = parseDate(firstDate).getMonth();
        if (month !== lastMonth) {
          labels.push({ month: getMonthAbbr(month), weekIndex });
          lastMonth = month;
        }
      }
    });

    return labels;
  }, [calendarGrid]);

  const handleThemeSave = () => {
    setYearTheme(selectedYear, themeInput);
    setEditingTheme(false);
  };

  const dayLabels = weekStartsOn === 1
    ? ['M', '', 'W', '', 'F', '', 'S']
    : ['S', '', 'T', '', 'T', '', 'S'];

  return (
    <div className="space-y-6">
      {/* This week — the lens, closed by default */}
      {/*
        A disclosure, not a panel: the same `[+]`/`[-]` the tower's drawers use,
        so the one gesture that opens a closed list looks the same everywhere.
        The whole label row stays the target — the arithmetic is what the owner
        reaches for, and it is inside the button rather than beside it.
      */}
      <Section
        label={
          <button
            onClick={() => onWeekOpenChange(!weekOpen)}
            aria-expanded={weekOpen}
            // `uppercase` is not inherited: preflight resets `text-transform`
            // on every button, so the section's casing stops at this element.
            className="flex w-full items-baseline justify-between gap-3 text-left uppercase transition-colors hover:text-text-secondary"
          >
            <span className="flex items-center gap-2">
              <span>{weekOpen ? '[-]' : '[+]'}</span>
              this week
            </span>
            <span className="normal-case tracking-normal text-text-secondary">
              week {getWeekNumber(selectedDate)} · tasks {totals.completedMits}/{totals.totalMits} ·
              notes {totals.daysWithNotes}/7
            </span>
          </button>
        }
      >
        {weekOpen && (
          <WeekView
            mirror={mirror}
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
            onPreviousWeek={onPreviousWeek}
            onNextWeek={onNextWeek}
          />
        )}
      </Section>

      {/* Energy — the ledger, on the same week as the lens above it */}
      <EnergySection
        mirror={mirror}
        selectedDate={selectedDate}
        weekStartsOn={weekStartsOn}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={onNextWeek}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <StepNav
          onPrev={() => onYearChange(selectedYear - 1)}
          onNext={() => onYearChange(selectedYear + 1)}
          label="year"
        >
          <span className="text-lg font-medium tabular-nums text-text">{selectedYear}</span>
        </StepNav>
      </div>

      {/* Theme */}
      <Section
        label="theme"
        aside={
          editingTheme ? undefined : (
            <button
              onClick={() => {
                setThemeInput(getYearTheme(selectedYear));
                setEditingTheme(true);
              }}
              className="text-xs text-text-muted hover:text-accent"
            >
              edit
            </button>
          )
        }
      >
        {editingTheme ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={themeInput}
              onChange={e => setThemeInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleThemeSave();
                if (e.key === 'Escape') setEditingTheme(false);
              }}
              placeholder="year focus"
              className="flex-1 font-read text-base text-text bg-transparent border-b border-border focus:border-accent outline-none"
              autoFocus
            />
            <button onClick={handleThemeSave} className="text-xs text-accent">
              save
            </button>
          </div>
        ) : (
          <p className="font-read text-base text-text-secondary">
            {getYearTheme(selectedYear) || '—'}
          </p>
        )}
      </Section>

      {/*
        The arithmetic and the picture of it, under one label. They were two
        cards saying one thing — a year of days, counted and then drawn — and
        two frames for one subject is exactly what the rule replaces.
      */}
      <Section label="consistency">
        <div className="text-xs text-text-muted space-y-1">
          <div>current streak: {yearStats.currentStreak} days</div>
          <div>longest streak: {yearStats.longestStreak} days</div>
          <div>perfect days: {yearStats.perfectDays}</div>
          <div>active days: {yearStats.daysWithHabits}/{yearStats.totalDays}</div>
          <div>consistency: {yearStats.totalDays > 0 ? Math.round((yearStats.daysWithHabits / yearStats.totalDays) * 100) : 0}%</div>
        </div>

        {/* Heatmap */}
        <div className="overflow-x-auto">
          <div className="min-w-[750px]">
            {/* Months */}
            <div className="flex mb-2 ml-6">
              {monthLabels.map(({ month, weekIndex }, i) => (
                <div
                  key={`${month}-${i}`}
                  className="text-xs text-text-muted"
                  style={{
                    position: 'relative',
                    left: `${weekIndex * 14}px`,
                    width: i < monthLabels.length - 1
                      ? `${(monthLabels[i + 1]?.weekIndex - weekIndex) * 14}px`
                      : 'auto',
                  }}
                >
                  {month}
                </div>
              ))}
            </div>

            <div className="flex gap-0.5">
              {/* Day labels */}
              <div className="flex flex-col gap-0.5 mr-1">
                {dayLabels.map((label, i) => (
                  <div key={i} className="h-3 text-xs text-text-muted text-right pr-1 leading-3 w-4">
                    {label}
                  </div>
                ))}
              </div>

              {/* Grid */}
              <div className="flex gap-0.5">
                {calendarGrid.map((week, weekIndex) => (
                  <div key={weekIndex} className="flex flex-col gap-0.5">
                    {week.map((date, dayIndex) =>
                      date ? (
                        <DayCell
                          key={date}
                          date={date}
                          habitCount={getHabitCount(date)}
                          totalHabits={habits.length}
                          didRead={read.days.has(date)}
                          onClick={() => onDateSelect(date)}
                        />
                      ) : (
                        <div key={`empty-${dayIndex}`} className="w-3 h-3" />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end mt-3 gap-1">
              <span className="text-xs text-text-muted mr-1">less</span>
              {HEAT_COLORS.map((color, i) => (
                <div key={i} className={`w-3 h-3 rounded-sm ${color}`} />
              ))}
              <span className="text-xs text-text-muted ml-1">more</span>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
