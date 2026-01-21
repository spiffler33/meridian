/**
 * Habits View
 *
 * Daily habit tracking and reflection.
 * Simple, binary tracking with streak awareness.
 */

import { useMemo, useState, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import { DateNavigation } from '../components/DateNavigation';
import { HabitGrid } from '../components/HabitGrid';
import { HabitStatsPopover } from '../components/HabitStatsPopover';
import { PacksSection } from '../components/PacksSection';
import { Reflection } from '../components/Reflection';
import { AiInsight } from '../components/AiInsight';
import { DailyInspiration } from '../components/DailyInspiration';
import { getHabitCompletionDates } from '../services/data';
import { calculateHabitStats } from '../utils/habitStats';
import type { HabitStats } from '../utils/habitStats';
import type { HabitDefinition, HabitId } from '../types';

interface HabitsViewProps {
  selectedDate: string;
  onPrevious: () => void;
  onNext: () => void;
  onDateSelect: (date: string) => void;
}

// Popover state
interface PopoverState {
  habitId: HabitId;
  habit: HabitDefinition;
  stats: HabitStats;
  position: { top: number; left: number };
}

export function HabitsView({ selectedDate, onPrevious, onNext, onDateSelect }: HabitsViewProps) {
  const {
    state,
    getDailyData,
    toggleHabit,
    setReflection,
    getHabitStreak,
    addPack,
    archivePackById,
    logPackSession,
    removePackSession,
  } = useApp();

  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

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

  // Handle opening habit stats popover
  const handleHabitStats = useCallback(async (habitId: HabitId, anchorRect: DOMRect) => {
    // If same habit clicked, close popover
    if (popover?.habitId === habitId) {
      setPopover(null);
      return;
    }

    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;

    setLoadingStats(true);

    try {
      // Fetch completion dates from Supabase
      const completionDates = await getHabitCompletionDates(habitId);

      // Calculate stats using pure functions
      const stats = calculateHabitStats(completionDates);

      // Position popover below the habit row
      const position = {
        top: anchorRect.bottom + window.scrollY + 8,
        left: Math.max(16, Math.min(anchorRect.left, window.innerWidth - 296)),
      };

      setPopover({ habitId, habit, stats, position });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to load habit stats:', err);
    } finally {
      setLoadingStats(false);
    }
  }, [popover?.habitId, habits]);

  // Close popover
  const handleClosePopover = useCallback(() => {
    setPopover(null);
  }, []);

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
          {loadingStats && <span className="ml-2">...</span>}
        </div>
      )}

      {/* Habits grid */}
      <HabitGrid
        habits={habits}
        completedHabits={dayData.habits}
        streaks={habitStreaks}
        onToggle={habitId => toggleHabit(selectedDate, habitId)}
        onHabitStats={handleHabitStats}
      />

      {/* Habit Stats Popover */}
      {popover && (
        <div
          style={{
            position: 'absolute',
            top: popover.position.top,
            left: popover.position.left,
          }}
        >
          <HabitStatsPopover
            habit={popover.habit}
            stats={popover.stats}
            onClose={handleClosePopover}
          />
        </div>
      )}

      {/* Packs */}
      <PacksSection
        packs={state.packs}
        onLogSession={async (packId, date, note) => {
          await logPackSession({ packId, date, note });
        }}
        onRemoveSession={removePackSession}
        onCreatePack={async (label, total) => {
          await addPack({ label, total });
        }}
        onArchivePack={archivePackById}
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
