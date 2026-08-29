/**
 * Habit Grid
 *
 * Daily habits as simple toggles. No emojis, just labels.
 * Stoic display - facts only.
 *
 * Click ● to toggle completion.
 * Click habit label to view stats popover.
 */

import { useRef } from 'react';
import { Section } from './Section';
import type { HabitDefinition, HabitId } from '../types';

/**
 * The row tone shared with `PacksSection`'s pack rows — the same "this one is
 * on" statement in two lists, so it is written once.
 *
 * No `/opacity` on the tokens: `bg-accent/5` and `border-accent/50` compiled to
 * no rule at all, which is why the active tint had never once rendered.
 * `accent-wash` and `accent-rim` are mixed by name in `index.css`.
 *
 * Idle carries no fill. It used to be `bg-bg-card` on a `bg-bg-card` card,
 * where it did nothing; with the card gone it would be a raised block on the
 * page, and a block that means nothing is the one thing a fill must never be.
 * The hairline is the tap target — the only frame left in this section — and
 * the wash now says "on" and nothing else says anything.
 */
export const ROW_TONE_ACTIVE = 'border-accent-rim bg-accent-wash text-text';
export const ROW_TONE_IDLE = 'border-border text-text-secondary hover:border-border-focus';

interface HabitGridProps {
  habits: HabitDefinition[];
  completedHabits: Record<HabitId, boolean>;
  streaks: Record<HabitId, number>;
  isHoliday?: boolean;
  onToggle: (habitId: HabitId) => void;
  onHabitStats?: (habitId: HabitId, anchorRect: DOMRect) => void;
}

interface HabitToggleProps {
  habit: HabitDefinition;
  isCompleted: boolean;
  streak: number;
  onToggle: () => void;
  onStats?: (anchorRect: DOMRect) => void;
}

function HabitToggle({ habit, isCompleted, streak, onToggle, onStats }: HabitToggleProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  const handleLabelClick = () => {
    if (onStats && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      onStats(rect);
    }
  };

  return (
    <div
      ref={rowRef}
      className={`
        flex items-center gap-2 px-3 py-2 rounded border text-left transition-colors text-sm
        ${isCompleted ? ROW_TONE_ACTIVE : ROW_TONE_IDLE}
      `}
      title={habit.description}
    >
      <button
        onClick={onToggle}
        className={`flex-shrink-0 ${isCompleted ? 'text-accent' : 'text-text-muted'} hover:opacity-80 transition-opacity`}
        aria-label={isCompleted ? 'Mark incomplete' : 'Mark complete'}
      >
        {isCompleted ? '●' : '○'}
      </button>
      <button
        onClick={handleLabelClick}
        className="truncate flex-1 text-left hover:text-text transition-colors"
      >
        {habit.label}
      </button>
      {streak > 0 && (
        <span className="text-xs text-text-muted flex-shrink-0 tabular-nums">{streak}d</span>
      )}
    </div>
  );
}

export function HabitGrid({ habits, completedHabits, streaks, isHoliday, onToggle, onHabitStats }: HabitGridProps) {
  if (habits.length === 0) return null;

  const completedCount = Object.values(completedHabits).filter(Boolean).length;

  return (
    // The rest-day dimming is the whole section's, label included, so it sits
    // outside the rule rather than on the grid alone.
    <div className={isHoliday ? 'opacity-60' : undefined}>
      <Section
        label={
          <>
            habits {isHoliday && <span className="normal-case">(rest day)</span>}
          </>
        }
        aside={
          isHoliday ? undefined : (
            <span className="text-xs text-text-muted tabular-nums">
              {completedCount}/{habits.length}
            </span>
          )
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {habits.map(habit => (
            <HabitToggle
              key={habit.id}
              habit={habit}
              isCompleted={completedHabits[habit.id] || false}
              streak={streaks[habit.id] || 0}
              onToggle={() => onToggle(habit.id)}
              onStats={onHabitStats ? (rect) => onHabitStats(habit.id, rect) : undefined}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}
