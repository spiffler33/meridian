/**
 * Week View
 *
 * 7-day overview. Factual stats per day.
 *
 * Not a place any more: the week is a lens the Year view opens, so this
 * renders inside that section rather than under a tab of its own.
 */

import { useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { AiInsight } from '../components/AiInsight';
import { getWeekDates, formatShortDate, getDayOfWeek, isToday, getWeekNumber, getToday } from '../utils/dates';
import { AllDayChip, Dot } from '../components/calendarUi';
import { deviceTimeZone, eventsForDays, timeLabel } from '../lib/calendar';
import type { CalendarEvent, CalendarMirror } from '../lib/calendar';
import { weekTotals } from '../utils/weekTotals';

/**
 * How many events a day card shows before it stops counting them out. Past
 * five the card stops being a glance and starts being a list.
 */
const LANE_CAP = 5;

interface WeekViewProps {
  mirror: CalendarMirror | null;
  selectedDate: string;
  onDateSelect: (date: string) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
}

interface DayCardProps {
  date: string;
  events: CalendarEvent[];
  timeZone: string;
  mitCount: { total: number; completed: number };
  habitCount: { total: number; completed: number };
  hasReflection: boolean;
  isSelected: boolean;
  onClick: () => void;
}

function DayCard({
  date,
  events,
  timeZone,
  mitCount,
  habitCount,
  hasReflection,
  isSelected,
  onClick,
}: DayCardProps) {
  const today = isToday(date);
  // A day that is over is context, not a plan. The whole lane recedes rather
  // than each row arguing for itself.
  const past = date < getToday();
  const shown = events.slice(0, LANE_CAP);
  const hidden = events.length - shown.length;

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

      {shown.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-sp-hair pt-2">
          {shown.map(event =>
            event.allDay ? (
              <div key={event.id} className="flex">
                <AllDayChip event={event} faded={past} />
              </div>
            ) : (
              <div key={event.id} className="flex items-baseline gap-1.5">
                <span className="translate-y-[-2px]">
                  <Dot calendar={event.calendar} />
                </span>
                <span
                  className={`flex-shrink-0 font-mono text-[10.5px] tabular-nums ${
                    past ? 'text-sp-faint' : 'text-sp-muted'
                  }`}
                >
                  {timeLabel(event.start, timeZone)}
                </span>
                <span
                  className={`truncate font-mono text-[10.5px] ${
                    past ? 'text-sp-faint' : 'text-sp-muted'
                  }`}
                >
                  {event.title}
                </span>
              </div>
            )
          )}
          {hidden > 0 && (
            <div className="font-mono text-[10.5px] text-sp-faint">+{hidden}</div>
          )}
        </div>
      )}
    </button>
  );
}

export function WeekView({
  mirror,
  selectedDate,
  onDateSelect,
  onPreviousWeek,
  onNextWeek,
}: WeekViewProps) {
  const { state, getDailyData, getHabitCount, getHabitStreak } = useApp();
  // Memoised because the event buckets below key off it: a fresh array every
  // render would rebuild them every render.
  const weekDates = useMemo(
    () => getWeekDates(selectedDate, state.settings.weekStartsOn),
    [selectedDate, state.settings.weekStartsOn]
  );
  const weekNumber = getWeekNumber(selectedDate);
  const habits = state.settings.habits;
  const selectedDayData = getDailyData(selectedDate);
  const timeZone = deviceTimeZone();
  // One pass over the mirror for the whole week, rather than one per card.
  const eventsByDay = useMemo(
    () => eventsForDays(mirror, weekDates, timeZone),
    [mirror, weekDates, timeZone]
  );

  // Calculate streaks for all habits (for AI insight)
  const habitStreaks = useMemo(() => {
    const streaks: Record<string, number> = {};
    for (const habit of habits) {
      streaks[habit.id] = getHabitStreak(habit.id, selectedDate);
    }
    return streaks;
  }, [habits, getHabitStreak, selectedDate]);

  // Stats
  const { totalMits, completedMits, daysWithNotes } = weekTotals(weekDates, getDailyData);

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
              events={eventsByDay.get(date) ?? []}
              timeZone={timeZone}
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
