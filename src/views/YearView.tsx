/**
 * Year View
 *
 * GitHub-style contribution heatmap showing habit completion throughout the year.
 * Each day's intensity is based on number of habits completed.
 */

import React, { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { getYearCalendarGrid, formatShortDate, getMonthAbbr, isToday, isFuture, parseDate } from '../utils/dates';

interface YearViewProps {
  selectedYear: number;
  onYearChange: (year: number) => void;
  onDateSelect: (date: string) => void;
}

// Calculate which heat level (0-5) based on habit count
function getHeatLevel(habitCount: number, totalHabits: number): number {
  if (habitCount === 0) return 0;
  const percentage = habitCount / totalHabits;
  if (percentage >= 1) return 5;
  if (percentage >= 0.7) return 4;
  if (percentage >= 0.5) return 3;
  if (percentage >= 0.3) return 2;
  return 1;
}

// Heat level to Tailwind color class mapping
const HEAT_COLORS = [
  'bg-heat-0', // 0 habits
  'bg-heat-1', // 1-2 habits (low)
  'bg-heat-2', // 3+ habits (medium-low)
  'bg-heat-3', // 4+ habits (medium)
  'bg-heat-4', // 5+ habits (high)
  'bg-heat-5', // All habits (perfect)
];

interface DayCellProps {
  date: string;
  habitCount: number;
  totalHabits: number;
  onClick: () => void;
}

function DayCell({ date, habitCount, totalHabits, onClick }: DayCellProps) {
  const heatLevel = getHeatLevel(habitCount, totalHabits);
  const today = isToday(date);
  const future = isFuture(date);

  return (
    <button
      onClick={onClick}
      className={`
        w-3 h-3 rounded-sm transition-all hover:ring-2 hover:ring-accent-400 hover:ring-offset-1
        ${HEAT_COLORS[heatLevel]}
        ${today ? 'ring-2 ring-accent-500' : ''}
        ${future ? 'opacity-30' : ''}
      `}
      title={`${formatShortDate(date)}: ${habitCount}/${totalHabits} habits`}
      aria-label={`${formatShortDate(date)}: ${habitCount} habits completed`}
    />
  );
}

export function YearView({ selectedYear, onYearChange, onDateSelect }: YearViewProps) {
  const { state, getHabitCount, getYearTheme, setYearTheme } = useApp();
  const [editingTheme, setEditingTheme] = useState(false);
  const [themeInput, setThemeInput] = useState(getYearTheme(selectedYear));

  const habits = state.settings.habits;
  const weekStartsOn = state.settings.weekStartsOn;

  // Generate the calendar grid
  const calendarGrid = useMemo(
    () => getYearCalendarGrid(selectedYear, weekStartsOn),
    [selectedYear, weekStartsOn]
  );

  // Calculate year stats
  const yearStats = useMemo(() => {
    let totalDays = 0;
    let daysWithHabits = 0;
    let perfectDays = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    const today = new Date();
    const sortedDates: string[] = [];

    // Collect all dates in the year up to today
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

    // Calculate current streak (from today backwards)
    for (let i = sortedDates.length - 1; i >= 0; i--) {
      const count = getHabitCount(sortedDates[i]);
      if (count > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    return { totalDays, daysWithHabits, perfectDays, currentStreak, longestStreak };
  }, [calendarGrid, getHabitCount, habits.length]);

  // Calculate month labels positions
  const monthLabels = useMemo(() => {
    const labels: { month: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    calendarGrid.forEach((week, weekIndex) => {
      // Find the first valid date in this week
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

  const handleThemeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleThemeSave();
    if (e.key === 'Escape') {
      setThemeInput(getYearTheme(selectedYear));
      setEditingTheme(false);
    }
  };

  const dayLabels = weekStartsOn === 1
    ? ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
    : ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];

  return (
    <div className="space-y-6">
      {/* Year header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onYearChange(selectedYear - 1)}
            className="p-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors"
            aria-label="Previous year"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-2xl sm:text-3xl font-bold text-surface-800">{selectedYear}</h2>
          <button
            onClick={() => onYearChange(selectedYear + 1)}
            className="p-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors"
            aria-label="Next year"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Year theme */}
      <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-surface-600">Year Theme</h3>
          {!editingTheme && (
            <button
              onClick={() => setEditingTheme(true)}
              className="text-xs text-accent-600 hover:text-accent-700"
            >
              Edit
            </button>
          )}
        </div>
        {editingTheme ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={themeInput}
              onChange={e => setThemeInput(e.target.value)}
              onKeyDown={handleThemeKeyDown}
              placeholder="e.g., Health & compounding projects"
              className="flex-1 text-lg text-surface-700 bg-surface-50 rounded-lg px-3 py-2 border border-surface-200 focus:border-accent-400 focus:ring-1 focus:ring-accent-400 outline-none"
              autoFocus
            />
            <button
              onClick={handleThemeSave}
              className="px-4 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors text-sm font-medium"
            >
              Save
            </button>
          </div>
        ) : (
          <p className="text-lg text-surface-700 italic">
            {getYearTheme(selectedYear) || 'No theme set — click Edit to add one'}
          </p>
        )}
      </div>

      {/* Year stats */}
      <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-5">
        <h3 className="text-sm font-medium text-surface-600 mb-3">Year Progress</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="text-center">
            <div className="text-2xl font-semibold text-surface-800">{yearStats.currentStreak}</div>
            <div className="text-xs text-surface-500 mt-1">Current streak</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-surface-800">{yearStats.longestStreak}</div>
            <div className="text-xs text-surface-500 mt-1">Longest streak</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-accent-600">{yearStats.perfectDays}</div>
            <div className="text-xs text-surface-500 mt-1">Perfect days</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-surface-800">{yearStats.daysWithHabits}</div>
            <div className="text-xs text-surface-500 mt-1">Days with habits</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-surface-800">
              {yearStats.totalDays > 0 ? Math.round((yearStats.daysWithHabits / yearStats.totalDays) * 100) : 0}%
            </div>
            <div className="text-xs text-surface-500 mt-1">Consistency</div>
          </div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-5 overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Month labels */}
          <div className="flex mb-2 ml-8">
            {monthLabels.map(({ month, weekIndex }, i) => (
              <div
                key={`${month}-${i}`}
                className="text-xs text-surface-500"
                style={{
                  position: 'relative',
                  left: `${weekIndex * 16}px`,
                  width: i < monthLabels.length - 1
                    ? `${(monthLabels[i + 1]?.weekIndex - weekIndex) * 16}px`
                    : 'auto',
                }}
              >
                {month}
              </div>
            ))}
          </div>

          {/* Grid with day labels */}
          <div className="flex gap-1">
            {/* Day labels */}
            <div className="flex flex-col gap-0.5 mr-1">
              {dayLabels.map((label, i) => (
                <div key={i} className="h-3 text-xs text-surface-400 text-right pr-1 leading-3">
                  {label}
                </div>
              ))}
            </div>

            {/* Weeks */}
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
          <div className="flex items-center justify-end mt-4 gap-2">
            <span className="text-xs text-surface-500">Less</span>
            {HEAT_COLORS.map((color, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-sm ${color}`}
                title={`Level ${i}`}
              />
            ))}
            <span className="text-xs text-surface-500">More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
