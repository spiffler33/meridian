/**
 * Habit Statistics - Pure calculation functions
 *
 * All functions are pure - they take data in, return calculations out.
 * No side effects, no API calls, easily testable.
 */

import { formatDate, parseDate, getToday, addDays } from './dates';

// ============================================================================
// Types
// ============================================================================

export interface HabitStats {
  currentStreak: number;
  longestStreak: number;
  thisWeek: PeriodStats;
  thisMonth: PeriodStats;
  thisYear: PeriodStats;
  monthCalendar: MonthCalendarDay[];
}

interface PeriodStats {
  completed: number;
  total: number;
  percentage: number;
}

interface MonthCalendarDay {
  date: string;
  completed: boolean;
  isToday: boolean;
  isFuture: boolean;
}

// ============================================================================
// Streak Calculations
// ============================================================================

/**
 * Calculate current streak from an array of completion dates.
 * Streak is consecutive days ending at today or yesterday.
 */
function calculateCurrentStreak(completionDates: string[], today: string = getToday()): number {
  if (completionDates.length === 0) return 0;

  // Sort dates descending (most recent first)
  const sorted = [...completionDates].sort((a, b) => b.localeCompare(a));
  const yesterday = addDays(today, -1);

  // Check if the most recent completion is today or yesterday
  if (sorted[0] !== today && sorted[0] !== yesterday) {
    return 0;
  }

  let streak = 0;
  let expectedDate = sorted[0] === today ? today : yesterday;

  for (const date of sorted) {
    if (date === expectedDate) {
      streak++;
      expectedDate = addDays(expectedDate, -1);
    } else if (date < expectedDate) {
      // Gap found, streak broken
      break;
    }
    // Skip duplicates (date > expectedDate shouldn't happen with sorted desc)
  }

  return streak;
}

/**
 * Calculate the longest streak from an array of completion dates.
 */
function calculateLongestStreak(completionDates: string[]): number {
  if (completionDates.length === 0) return 0;

  // Sort dates ascending
  const sorted = [...completionDates].sort((a, b) => a.localeCompare(b));

  let longest = 1;
  let current = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = sorted[i - 1];
    const currDate = sorted[i];
    const expectedNext = addDays(prevDate, 1);

    if (currDate === expectedNext) {
      current++;
      longest = Math.max(longest, current);
    } else if (currDate !== prevDate) {
      // Reset streak (but not for duplicates)
      current = 1;
    }
  }

  return longest;
}

// ============================================================================
// Period Stats Calculations
// ============================================================================

/**
 * Get the start of the current week (Monday).
 */
function getWeekStart(today: string = getToday()): string {
  const date = parseDate(today);
  const dayOfWeek = date.getDay();
  // Convert Sunday (0) to 7 for easier math, Monday = 1
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return addDays(today, -daysFromMonday);
}

/**
 * Get the start of the current month.
 */
function getMonthStart(today: string = getToday()): string {
  const date = parseDate(today);
  return formatDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

/**
 * Get the start of the current year.
 */
function getYearStart(today: string = getToday()): string {
  const date = parseDate(today);
  return formatDate(new Date(date.getFullYear(), 0, 1));
}

/**
 * Count days between two dates (inclusive of start, exclusive of end).
 */
function countDays(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Calculate stats for a period.
 */
function calculatePeriodStats(
  completionDates: string[],
  periodStart: string,
  periodEnd: string
): PeriodStats {
  const total = countDays(periodStart, periodEnd);
  const completionsInPeriod = completionDates.filter(
    date => date >= periodStart && date <= periodEnd
  );
  const completed = completionsInPeriod.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { completed, total, percentage };
}

/**
 * Calculate this week's stats.
 */
function calculateThisWeek(completionDates: string[], today: string = getToday()): PeriodStats {
  const weekStart = getWeekStart(today);
  return calculatePeriodStats(completionDates, weekStart, today);
}

/**
 * Calculate this month's stats.
 */
function calculateThisMonth(completionDates: string[], today: string = getToday()): PeriodStats {
  const monthStart = getMonthStart(today);
  return calculatePeriodStats(completionDates, monthStart, today);
}

/**
 * Calculate this year's stats.
 */
function calculateThisYear(completionDates: string[], today: string = getToday()): PeriodStats {
  const yearStart = getYearStart(today);
  return calculatePeriodStats(completionDates, yearStart, today);
}

// ============================================================================
// Month Calendar
// ============================================================================

/**
 * Generate a mini calendar for the current month.
 * Returns an array of days with completion status.
 */
function generateMonthCalendar(
  completionDates: string[],
  today: string = getToday()
): MonthCalendarDay[] {
  const todayDate = parseDate(today);
  const year = todayDate.getFullYear();
  const month = todayDate.getMonth();

  // Get the last day of the month
  const lastDay = new Date(year, month + 1, 0).getDate();

  const completionSet = new Set(completionDates);
  const days: MonthCalendarDay[] = [];

  for (let day = 1; day <= lastDay; day++) {
    const date = formatDate(new Date(year, month, day));
    days.push({
      date,
      completed: completionSet.has(date),
      isToday: date === today,
      isFuture: date > today,
    });
  }

  return days;
}

// ============================================================================
// Main Stats Calculator
// ============================================================================

/**
 * Calculate all habit statistics from completion dates.
 * This is the main function to use for the popover.
 */
export function calculateHabitStats(
  completionDates: string[],
  today: string = getToday()
): HabitStats {
  return {
    currentStreak: calculateCurrentStreak(completionDates, today),
    longestStreak: calculateLongestStreak(completionDates),
    thisWeek: calculateThisWeek(completionDates, today),
    thisMonth: calculateThisMonth(completionDates, today),
    thisYear: calculateThisYear(completionDates, today),
    monthCalendar: generateMonthCalendar(completionDates, today),
  };
}
