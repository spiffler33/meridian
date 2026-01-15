/**
 * Habit Grid Component
 *
 * Displays habit toggles in a clean grid layout.
 * Each habit is a simple on/off toggle with a satisfying click.
 */

import type { HabitDefinition, HabitId } from '../types';

interface HabitGridProps {
  habits: HabitDefinition[];
  completedHabits: Record<HabitId, boolean>;
  onToggle: (habitId: HabitId) => void;
}

interface HabitToggleProps {
  habit: HabitDefinition;
  isCompleted: boolean;
  onToggle: () => void;
}

function HabitToggle({ habit, isCompleted, onToggle }: HabitToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`
        relative flex items-center gap-2 px-3 py-3 sm:py-2 rounded-lg border transition-all
        min-h-[48px] active:scale-[0.98]
        ${
          isCompleted
            ? 'bg-accent-50 border-accent-300 text-accent-700'
            : 'bg-white border-surface-200 text-surface-600 hover:border-surface-300 active:bg-surface-50'
        }
      `}
      title={habit.description}
    >
      {/* Emoji or checkbox indicator */}
      <span className="text-sm flex-shrink-0">
        {habit.emoji || (isCompleted ? '✓' : '○')}
      </span>

      {/* Label */}
      <span className="text-sm font-medium truncate">{habit.label}</span>

      {/* Completed indicator */}
      {isCompleted && (
        <svg
          className="w-4 h-4 text-accent-500 flex-shrink-0 ml-auto"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

export function HabitGrid({ habits, completedHabits, onToggle }: HabitGridProps) {
  const completedCount = Object.values(completedHabits).filter(Boolean).length;

  return (
    <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-surface-800">Daily Anchors</h3>
        <div className="text-xs text-surface-500">
          {completedCount}/{habits.length} complete
        </div>
      </div>

      {/* Grid of habits */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {habits.map(habit => (
          <HabitToggle
            key={habit.id}
            habit={habit}
            isCompleted={completedHabits[habit.id] || false}
            onToggle={() => onToggle(habit.id)}
          />
        ))}
      </div>

      {/* Progress message */}
      {completedCount > 0 && (
        <div className="mt-4 text-center">
          <span className="text-sm text-surface-500">
            {completedCount === habits.length
              ? 'All anchors hit today!'
              : `${habits.length - completedCount} more to go`}
          </span>
        </div>
      )}
    </div>
  );
}
