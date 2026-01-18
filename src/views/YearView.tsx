/**
 * Year View
 *
 * Heatmap of habit completion. Terminal-style stats.
 */

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { getYearCalendarGrid, formatShortDate, getMonthAbbr, isToday, isFuture, parseDate } from '../utils/dates';

interface YearViewProps {
  selectedYear: number;
  onYearChange: (year: number) => void;
  onDateSelect: (date: string) => void;
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
        w-3 h-3 rounded-sm transition-all hover:ring-1 hover:ring-accent
        ${HEAT_COLORS[heatLevel]}
        ${today ? 'ring-1 ring-accent' : ''}
        ${future ? 'opacity-30' : ''}
      `}
      title={`${formatShortDate(date)}: ${habitCount}/${totalHabits}`}
    />
  );
}

export function YearView({ selectedYear, onYearChange, onDateSelect }: YearViewProps) {
  const { state, getHabitCount, getYearTheme, setYearTheme } = useApp();
  const { profile, updateProfile } = useAuth();
  const [editingTheme, setEditingTheme] = useState(false);
  const [themeInput, setThemeInput] = useState(getYearTheme(selectedYear));
  const [editingContext, setEditingContext] = useState(false);
  const [contextInput, setContextInput] = useState(profile?.personal_context || '');

  const habits = state.settings.habits;
  const weekStartsOn = state.settings.weekStartsOn;

  // Update themeInput when year changes or themes load from Supabase
  useEffect(() => {
    setThemeInput(getYearTheme(selectedYear));
  }, [selectedYear, getYearTheme]);

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

  const handleContextSave = () => {
    updateProfile({ personal_context: contextInput });
    setEditingContext(false);
  };

  const dayLabels = weekStartsOn === 1
    ? ['M', '', 'W', '', 'F', '', 'S']
    : ['S', '', 'T', '', 'T', '', 'S'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onYearChange(selectedYear - 1)}
            className="text-text-muted hover:text-text transition-colors"
          >
            ‹
          </button>
          <span className="text-lg font-medium text-text">{selectedYear}</span>
          <button
            onClick={() => onYearChange(selectedYear + 1)}
            className="text-text-muted hover:text-text transition-colors"
          >
            ›
          </button>
        </div>
      </div>

      {/* Theme */}
      <div className="bg-bg-card rounded border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted uppercase tracking-wide">theme</span>
          {!editingTheme && (
            <button
              onClick={() => setEditingTheme(true)}
              className="text-xs text-text-muted hover:text-accent"
            >
              edit
            </button>
          )}
        </div>
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
              className="flex-1 text-sm text-text bg-transparent border-b border-border focus:border-accent outline-none"
              autoFocus
            />
            <button onClick={handleThemeSave} className="text-xs text-accent">
              save
            </button>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            {getYearTheme(selectedYear) || '—'}
          </p>
        )}
      </div>

      {/* Personal Context */}
      <div className="bg-bg-card rounded border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted uppercase tracking-wide">what should the ai know about you?</span>
          {!editingContext && (
            <button
              onClick={() => {
                setContextInput(profile?.personal_context || '');
                setEditingContext(true);
              }}
              className="text-xs text-text-muted hover:text-accent"
            >
              edit
            </button>
          )}
        </div>
        {editingContext ? (
          <div className="space-y-2">
            <textarea
              value={contextInput}
              onChange={e => setContextInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setEditingContext(false);
              }}
              onBlur={handleContextSave}
              placeholder="health goals, struggles, what matters this year..."
              className="w-full text-sm text-text bg-transparent border border-border rounded p-2 focus:border-accent outline-none resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex justify-end">
              <button onClick={handleContextSave} className="text-xs text-accent">
                save
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary whitespace-pre-wrap">
            {profile?.personal_context || '—'}
          </p>
        )}
      </div>

      {/* Stats - terminal style */}
      <div className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted font-mono space-y-1">
          <div>current streak: {yearStats.currentStreak} days</div>
          <div>longest streak: {yearStats.longestStreak} days</div>
          <div>perfect days: {yearStats.perfectDays}</div>
          <div>active days: {yearStats.daysWithHabits}/{yearStats.totalDays}</div>
          <div>consistency: {yearStats.totalDays > 0 ? Math.round((yearStats.daysWithHabits / yearStats.totalDays) * 100) : 0}%</div>
        </div>
      </div>

      {/* Heatmap */}
      <div className="bg-bg-card rounded border border-border p-4 overflow-x-auto">
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
    </div>
  );
}
