/**
 * Habits View
 *
 * Daily habit tracking and reflection.
 * Simple, binary tracking with streak awareness.
 */

import { useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { DateNavigation } from '../components/DateNavigation';
import { HabitGrid } from '../components/HabitGrid';
import { Reflection } from '../components/Reflection';
import { AiInsight } from '../components/AiInsight';
import { DailyInspiration } from '../components/DailyInspiration';

interface HabitsViewProps {
  selectedDate: string;
  onPrevious: () => void;
  onNext: () => void;
  onDateSelect: (date: string) => void;
}

export function HabitsView({ selectedDate, onPrevious, onNext, onDateSelect }: HabitsViewProps) {
  const {
    state,
    getDailyData,
    toggleHabit,
    setReflection,
    getHabitStreak,
  } = useApp();

  const dayData = getDailyData(selectedDate);
  const habits = state.settings.habits;

  // Calculate streaks for all habits
  const habitStreaks = useMemo(() => {
    const streaks: Record<string, number> = {};
    for (const habit of habits) {
      streaks[habit.id] = getHabitStreak(habit.id, selectedDate);
    }
    return streaks;
  }, [habits, getHabitStreak, selectedDate]);

  const completedCount = Object.values(dayData.habits).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <DateNavigation
        selectedDate={selectedDate}
        onPrevious={onPrevious}
        onNext={onNext}
        onDateSelect={onDateSelect}
      />

      {/* Daily Naval quote */}
      <DailyInspiration selectedDate={selectedDate} />

      {/* Status line */}
      {habits.length > 0 && (
        <div className="text-xs text-text-muted font-mono">
          {completedCount}/{habits.length} habits completed
        </div>
      )}

      {/* Habits grid */}
      <HabitGrid
        habits={habits}
        completedHabits={dayData.habits}
        streaks={habitStreaks}
        onToggle={habitId => toggleHabit(selectedDate, habitId)}
      />

      {/* Reflection */}
      <Reflection
        value={dayData.reflection}
        onChange={value => setReflection(selectedDate, value)}
      />

      {/* AI Insight */}
      <AiInsight
        selectedDate={selectedDate}
        habits={habits}
        completedHabits={dayData.habits}
        streaks={habitStreaks}
        tasksCompleted={0}
        totalTasks={0}
        reflection={dayData.reflection}
        dailyData={state.dailyData}
      />
    </div>
  );
}
