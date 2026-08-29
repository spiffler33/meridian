/**
 * Habit Stats Popover
 *
 * Click a habit to see depth without leaving the flow.
 * Shows streaks, period stats, and mini calendar visualization.
 */

import { useRef } from 'react';
import type { HabitDefinition } from '../types';
import type { HabitStats } from '../utils/habitStats';
import { useDismiss } from '../hooks/useDismiss';
import { parseDate } from '../utils/dates';

interface HabitStatsPopoverProps {
  habit: HabitDefinition;
  stats: HabitStats;
  onClose: () => void;
}

export function HabitStatsPopover({ habit, stats, onClose }: HabitStatsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Escape, or a press outside, closes it.
  useDismiss(popoverRef, onClose);

  // Get month name for calendar header
  const monthName = stats.monthCalendar.length > 0
    ? parseDate(stats.monthCalendar[0].date).toLocaleDateString('en-US', { month: 'short' }).toLowerCase()
    : '';

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 bg-bg-card border border-border rounded p-4 min-w-[240px] max-w-[280px]"
      role="dialog"
      aria-label={`Stats for ${habit.label}`}
    >
      {/* Header */}
      <div className="text-sm font-medium text-text uppercase tracking-caps mb-4">
        {habit.label}
      </div>

      {/* Streaks */}
      <div className="space-y-2 mb-4">
        <StatRow label="streak" value={`${stats.currentStreak}d`} />
        <StatRow label="longest" value={`${stats.longestStreak}d`} />
      </div>

      {/* Divider */}
      <div className="border-t border-border my-3" />

      {/* Period stats */}
      <div className="space-y-2 mb-4">
        <PeriodRow
          label="this week"
          completed={stats.thisWeek.completed}
          total={stats.thisWeek.total}
          percentage={stats.thisWeek.percentage}
        />
        <PeriodRow
          label="this month"
          completed={stats.thisMonth.completed}
          total={stats.thisMonth.total}
          percentage={stats.thisMonth.percentage}
        />
        <PeriodRow
          label="this year"
          completed={stats.thisYear.completed}
          total={stats.thisYear.total}
          percentage={stats.thisYear.percentage}
        />
      </div>

      {/* Divider */}
      <div className="border-t border-border my-3" />

      {/* Mini calendar */}
      <div>
        <div className="text-xs text-text-muted mb-2">{monthName}</div>
        <MiniCalendar days={stats.monthCalendar} />
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text tabular-nums">{value}</span>
    </div>
  );
}

function PeriodRow({
  label,
  completed,
  total,
  percentage,
}: {
  label: string;
  completed: number;
  total: number;
  percentage: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text tabular-nums">
        <span className="text-text-secondary">{completed}/{total}</span>
        <span className="text-text-muted ml-2">{percentage}%</span>
      </span>
    </div>
  );
}

function MiniCalendar({ days }: { days: HabitStats['monthCalendar'] }) {
  return (
    <div className="text-xs leading-relaxed tracking-label">
      {days.map((day) => (
        <span
          key={day.date}
          className={
            day.isFuture
              ? 'text-text-muted opacity-30'
              : day.completed
              ? 'text-accent'
              : 'text-text-muted'
          }
          title={day.date}
        >
          {day.isFuture ? '○' : day.completed ? '●' : '○'}
        </span>
      ))}
    </div>
  );
}
