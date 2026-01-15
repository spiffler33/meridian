/**
 * Week View
 *
 * Shows a weekly overview with summaries for each day.
 * Clicking a day navigates to that day's Today view.
 */

import { useApp } from '../store/AppContext';
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

  // Calculate fill level for visual indicator (0-4)
  const totalScore = (habitCount.completed >= habitCount.total * 0.5 ? 1 : 0) +
    (mitCount.completed >= mitCount.total * 0.5 ? 1 : 0) +
    (hasReflection ? 1 : 0) +
    (habitCount.completed === habitCount.total && habitCount.total > 0 ? 1 : 0);

  return (
    <button
      onClick={onClick}
      className={`
        relative p-4 rounded-xl border text-left transition-all hover:shadow-md
        ${today ? 'border-accent-300 bg-accent-50' : 'border-surface-200 bg-white'}
        ${isSelected ? 'ring-2 ring-accent-500 ring-offset-2' : ''}
      `}
    >
      {/* Day header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs font-medium text-surface-500 uppercase">
            {getDayOfWeek(date)}
          </div>
          <div className="text-lg font-semibold text-surface-800">
            {formatShortDate(date)}
          </div>
        </div>
        {today && (
          <span className="px-2 py-0.5 text-xs font-medium bg-accent-500 text-white rounded-full">
            Today
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="space-y-2">
        {/* MITs */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-surface-500">MITs</span>
          <span className={mitCount.total > 0 ? 'text-surface-700' : 'text-surface-300'}>
            {mitCount.completed}/{mitCount.total}
          </span>
        </div>

        {/* Habits */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-surface-500">Habits</span>
          <span className={habitCount.completed > 0 ? 'text-surface-700' : 'text-surface-300'}>
            {habitCount.completed}/{habitCount.total}
          </span>
        </div>

        {/* Reflection indicator */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-surface-500">Reflection</span>
          <span className={hasReflection ? 'text-accent-600' : 'text-surface-300'}>
            {hasReflection ? '✓' : '—'}
          </span>
        </div>
      </div>

      {/* Score indicator */}
      <div className="absolute bottom-2 right-2 flex gap-0.5">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${
              i < totalScore ? 'bg-accent-400' : 'bg-surface-200'
            }`}
          />
        ))}
      </div>
    </button>
  );
}

export function WeekView({ selectedDate, onDateSelect, onPreviousWeek, onNextWeek }: WeekViewProps) {
  const { state, getDailyData, getHabitCount } = useApp();
  const weekDates = getWeekDates(selectedDate, state.settings.weekStartsOn);
  const weekNumber = getWeekNumber(selectedDate);
  const habits = state.settings.habits;

  // Calculate week summary
  let totalMits = 0;
  let completedMits = 0;
  let daysWithHabits = 0;
  let perfectDays = 0;

  weekDates.forEach(date => {
    const dayData = getDailyData(date);
    const dayMits = dayData.mit.work.length + dayData.mit.self.length + dayData.mit.family.length;
    const dayCompletedMits =
      dayData.mit.work.filter(i => i.completed).length +
      dayData.mit.self.filter(i => i.completed).length +
      dayData.mit.family.filter(i => i.completed).length;
    const dayHabitCount = getHabitCount(date);

    totalMits += dayMits;
    completedMits += dayCompletedMits;

    if (dayHabitCount >= 4) daysWithHabits++;
    if (dayHabitCount === habits.length && habits.length > 0) perfectDays++;
  });

  return (
    <div className="space-y-6">
      {/* Week header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold text-surface-800">
            Week {weekNumber}
          </h2>
          <p className="text-sm text-surface-500 mt-1">
            {formatShortDate(weekDates[0])} — {formatShortDate(weekDates[6])}
          </p>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={onPreviousWeek}
            className="p-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors"
            aria-label="Previous week"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={onNextWeek}
            className="p-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors"
            aria-label="Next week"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Week summary */}
      <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-5">
        <h3 className="text-sm font-medium text-surface-600 mb-3">Week Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-semibold text-surface-800">
              {totalMits > 0 ? Math.round((completedMits / totalMits) * 100) : 0}%
            </div>
            <div className="text-xs text-surface-500 mt-1">MITs completed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-surface-800">{daysWithHabits}</div>
            <div className="text-xs text-surface-500 mt-1">Days with 4+ habits</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-accent-600">{perfectDays}</div>
            <div className="text-xs text-surface-500 mt-1">Perfect habit days</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-semibold text-surface-800">
              {completedMits}/{totalMits}
            </div>
            <div className="text-xs text-surface-500 mt-1">Total MITs</div>
          </div>
        </div>
      </div>

      {/* Day cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
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
    </div>
  );
}
