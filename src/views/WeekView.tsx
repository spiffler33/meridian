/**
 * Week View
 *
 * 7-day overview. Factual stats per day.
 */

import { useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { AiInsight } from '../components/AiInsight';
import { getWeekDates, formatShortDate, getDayOfWeek, isToday, getWeekNumber } from '../utils/dates';

interface WeekViewProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
}

interface DayCardProps {
  date: string;
  mitCount: { total: number; completed: number };
  habitCount: { total: number; completed: number };
  hasReflection: boolean;
  isSelected: boolean;
  onClick: () => void;
}

function DayCard({ date, mitCount, habitCount, hasReflection, isSelected, onClick }: DayCardProps) {
  const today = isToday(date);

  return (
    <button
      onClick={onClick}
      className={`
        p-3 rounded border text-left transition-all
        ${today ? 'border-accent/50 bg-accent/5' : 'border-border bg-bg-card hover:border-border-focus'}
        ${isSelected ? 'ring-1 ring-accent' : ''}
      `}
    >
      <div className="text-xs text-text-muted uppercase mb-1">
        {getDayOfWeek(date).slice(0, 3)}
      </div>
      <div className="text-sm font-medium text-text mb-2">
        {formatShortDate(date)}
        {today && <span className="ml-2 text-accent text-xs">•</span>}
      </div>

      <div className="space-y-1 text-xs font-mono text-text-muted">
        <div className="flex justify-between">
          <span>tasks</span>
          <span className={mitCount.completed > 0 ? 'text-text-secondary' : ''}>
            {mitCount.completed}/{mitCount.total}
          </span>
        </div>
        <div className="flex justify-between">
          <span>habits</span>
          <span className={habitCount.completed > 0 ? 'text-text-secondary' : ''}>
            {habitCount.completed}/{habitCount.total}
          </span>
        </div>
        <div className="flex justify-between">
          <span>notes</span>
          <span className={hasReflection ? 'text-accent' : ''}>
            {hasReflection ? 'yes' : '—'}
          </span>
        </div>
      </div>
    </button>
  );
}

export function WeekView({ selectedDate, onDateSelect, onPreviousWeek, onNextWeek }: WeekViewProps) {
  const { state, getDailyData, getHabitCount, getHabitStreak } = useApp();
  const weekDates = getWeekDates(selectedDate, state.settings.weekStartsOn);
  const weekNumber = getWeekNumber(selectedDate);
  const habits = state.settings.habits;
  const selectedDayData = getDailyData(selectedDate);

  // Calculate streaks for all habits (for AI insight)
  const habitStreaks = useMemo(() => {
    const streaks: Record<string, number> = {};
    for (const habit of habits) {
      streaks[habit.id] = getHabitStreak(habit.id, selectedDate);
    }
    return streaks;
  }, [habits, getHabitStreak, selectedDate]);

  // Stats
  let totalMits = 0;
  let completedMits = 0;
  let daysWithNotes = 0;

  weekDates.forEach(date => {
    const dayData = getDailyData(date);
    const dayMits = dayData.mit.work.length + dayData.mit.self.length + dayData.mit.family.length;
    const dayCompletedMits =
      dayData.mit.work.filter(i => i.completed).length +
      dayData.mit.self.filter(i => i.completed).length +
      dayData.mit.family.filter(i => i.completed).length;

    totalMits += dayMits;
    completedMits += dayCompletedMits;
    if (dayData.reflection.length > 0) daysWithNotes++;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-medium text-text">
            week {weekNumber}
          </div>
          <div className="text-xs text-text-muted font-mono mt-1">
            {formatShortDate(weekDates[0])} — {formatShortDate(weekDates[6])}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onPreviousWeek}
            className="p-2 text-text-muted hover:text-text transition-colors"
          >
            ‹
          </button>
          <button
            onClick={onNextWeek}
            className="p-2 text-text-muted hover:text-text transition-colors"
          >
            ›
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-bg-card rounded border border-border p-4">
        <div className="text-xs text-text-muted font-mono space-y-1">
          <div>tasks completed: {completedMits}/{totalMits}</div>
          <div>days with notes: {daysWithNotes}/7</div>
        </div>
      </div>

      {/* Days */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {weekDates.map(date => {
          const dayData = getDailyData(date);
          const dayMits = dayData.mit.work.length + dayData.mit.self.length + dayData.mit.family.length;
          const dayCompletedMits =
            dayData.mit.work.filter(i => i.completed).length +
            dayData.mit.self.filter(i => i.completed).length +
            dayData.mit.family.filter(i => i.completed).length;
          const dayHabitCount = getHabitCount(date);

          return (
            <DayCard
              key={date}
              date={date}
              mitCount={{ total: dayMits, completed: dayCompletedMits }}
              habitCount={{ total: habits.length, completed: dayHabitCount }}
              hasReflection={dayData.reflection.length > 0}
              isSelected={date === selectedDate}
              onClick={() => onDateSelect(date)}
            />
          );
        })}
      </div>

      {/* AI Insight */}
      <AiInsight
        selectedDate={selectedDate}
        habits={habits}
        completedHabits={selectedDayData.habits}
        streaks={habitStreaks}
        tasksCompleted={completedMits}
        totalTasks={totalMits}
        reflection={selectedDayData.reflection}
        dailyData={state.dailyData}
      />
    </div>
  );
}
