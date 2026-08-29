/**
 * Analytics Utilities
 *
 * Pre-compute habit statistics for AI insights.
 * Designed for token-efficiency: summarize, don't send raw data.
 */

import type { DailyData, HabitDefinition, HabitId } from '../types';
import { addDays, getToday, parseDate } from './dates';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface HabitAnalytics {
  name: string;
  completionRate: number; // 0-100
  dayOfWeekRates: Record<string, number>; // Mon: 80, Tue: 60, etc.
  currentStreak: number;
  bestStreak: number;
  trend: 'up' | 'down' | 'stable';
}

interface HabitCorrelation {
  habitA: string;
  habitB: string;
  correlation: number; // 0-100
}

interface DayPatterns {
  bestDay: string;
  worstDay: string;
  weekdayAvg: number;
  weekendAvg: number;
}

export interface HistoricalAnalytics {
  periodDays: number;
  habits: HabitAnalytics[];
  correlations: HabitCorrelation[];
  dayPatterns: DayPatterns;
  recentReflections: string[];
}

/**
 * Get array of dates for the analysis period (going backwards from today)
 */
function getDateRange(days: number, fromDate: string = getToday()): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(addDays(fromDate, -i));
  }
  return dates;
}

/**
 * Calculate completion rate for a habit over a date range
 */
function getCompletionRate(
  dailyData: Record<string, DailyData>,
  habitId: HabitId,
  dates: string[]
): number {
  let completed = 0;
  let total = 0;

  for (const date of dates) {
    const day = dailyData[date];
    if (day && day.habits[habitId] !== undefined) {
      total++;
      if (day.habits[habitId]) completed++;
    }
  }

  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

/**
 * Calculate completion rates by day of week
 */
function getDayOfWeekRates(
  dailyData: Record<string, DailyData>,
  habitId: HabitId,
  dates: string[]
): Record<string, number> {
  const counts: Record<string, { completed: number; total: number }> = {};

  for (const dayName of DAY_NAMES) {
    counts[dayName] = { completed: 0, total: 0 };
  }

  for (const date of dates) {
    const day = dailyData[date];
    const dayOfWeek = DAY_NAMES[parseDate(date).getDay()];

    if (day && day.habits[habitId] !== undefined) {
      counts[dayOfWeek].total++;
      if (day.habits[habitId]) counts[dayOfWeek].completed++;
    }
  }

  const rates: Record<string, number> = {};
  for (const dayName of DAY_NAMES) {
    const c = counts[dayName];
    rates[dayName] = c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
  }

  return rates;
}

/**
 * Calculate the best streak in a date range for a habit
 */
function getBestStreak(
  dailyData: Record<string, DailyData>,
  habitId: HabitId,
  dates: string[]
): number {
  // Sort dates in chronological order
  const sortedDates = [...dates].sort();
  let bestStreak = 0;
  let currentStreak = 0;

  for (const date of sortedDates) {
    const day = dailyData[date];
    if (day?.habits[habitId]) {
      currentStreak++;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return bestStreak;
}

/**
 * Calculate current streak (consecutive days ending today)
 */
function getCurrentStreak(
  dailyData: Record<string, DailyData>,
  habitId: HabitId,
  fromDate: string = getToday()
): number {
  let streak = 0;
  let currentDate = fromDate;

  // If not done today, check from yesterday
  const todayData = dailyData[currentDate];
  if (!todayData?.habits[habitId]) {
    currentDate = addDays(currentDate, -1);
  }

  while (true) {
    const dayData = dailyData[currentDate];
    if (dayData?.habits[habitId]) {
      streak++;
      currentDate = addDays(currentDate, -1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Determine trend: compare recent 7 days vs previous 7 days
 */
function getTrend(
  dailyData: Record<string, DailyData>,
  habitId: HabitId,
  fromDate: string = getToday()
): 'up' | 'down' | 'stable' {
  const recent7 = getDateRange(7, fromDate);
  const previous7 = getDateRange(7, addDays(fromDate, -7));

  const recentRate = getCompletionRate(dailyData, habitId, recent7);
  const previousRate = getCompletionRate(dailyData, habitId, previous7);

  const diff = recentRate - previousRate;

  if (diff > 10) return 'up';
  if (diff < -10) return 'down';
  return 'stable';
}

/**
 * Compute analytics for all habits
 */
function computeHabitAnalytics(
  dailyData: Record<string, DailyData>,
  habits: HabitDefinition[],
  days: number = 30,
  fromDate: string = getToday()
): HabitAnalytics[] {
  const dates = getDateRange(days, fromDate);

  return habits.map(habit => ({
    name: habit.label,
    completionRate: getCompletionRate(dailyData, habit.id, dates),
    dayOfWeekRates: getDayOfWeekRates(dailyData, habit.id, dates),
    currentStreak: getCurrentStreak(dailyData, habit.id, fromDate),
    bestStreak: getBestStreak(dailyData, habit.id, dates),
    trend: getTrend(dailyData, habit.id, fromDate),
  }));
}

/**
 * Compute correlations between habits (which habits are done together)
 * Returns top correlations only to minimize tokens
 */
function computeCorrelations(
  dailyData: Record<string, DailyData>,
  habits: HabitDefinition[],
  days: number = 30,
  fromDate: string = getToday()
): HabitCorrelation[] {
  const dates = getDateRange(days, fromDate);
  const correlations: HabitCorrelation[] = [];

  // Calculate co-occurrence for each pair
  for (let i = 0; i < habits.length; i++) {
    for (let j = i + 1; j < habits.length; j++) {
      const habitA = habits[i];
      const habitB = habits[j];

      let bothDone = 0;
      let eitherDone = 0;

      for (const date of dates) {
        const day = dailyData[date];
        if (!day) continue;

        const aCompleted = day.habits[habitA.id];
        const bCompleted = day.habits[habitB.id];

        if (aCompleted || bCompleted) {
          eitherDone++;
          if (aCompleted && bCompleted) {
            bothDone++;
          }
        }
      }

      if (eitherDone > 0) {
        const correlation = Math.round((bothDone / eitherDone) * 100);
        if (correlation >= 50) {
          // Only include meaningful correlations
          correlations.push({
            habitA: habitA.label,
            habitB: habitB.label,
            correlation,
          });
        }
      }
    }
  }

  // Sort by correlation strength and return top 5
  return correlations.sort((a, b) => b.correlation - a.correlation).slice(0, 5);
}

/**
 * Compute day-of-week patterns across all habits
 */
function computeDayPatterns(
  dailyData: Record<string, DailyData>,
  habits: HabitDefinition[],
  days: number = 30,
  fromDate: string = getToday()
): DayPatterns {
  const dates = getDateRange(days, fromDate);

  const dayTotals: Record<string, { completed: number; possible: number }> = {};
  for (const dayName of DAY_NAMES) {
    dayTotals[dayName] = { completed: 0, possible: 0 };
  }

  for (const date of dates) {
    const day = dailyData[date];
    const dayOfWeek = DAY_NAMES[parseDate(date).getDay()];

    for (const habit of habits) {
      if (day && day.habits[habit.id] !== undefined) {
        dayTotals[dayOfWeek].possible++;
        if (day.habits[habit.id]) {
          dayTotals[dayOfWeek].completed++;
        }
      }
    }
  }

  // Calculate rates per day
  const dayRates: Record<string, number> = {};
  for (const dayName of DAY_NAMES) {
    const t = dayTotals[dayName];
    dayRates[dayName] = t.possible > 0 ? Math.round((t.completed / t.possible) * 100) : 0;
  }

  // Find best and worst days
  const sortedDays = Object.entries(dayRates).sort((a, b) => b[1] - a[1]);
  const bestDay = sortedDays[0]?.[0] || 'Mon';
  const worstDay = sortedDays[sortedDays.length - 1]?.[0] || 'Sun';

  // Calculate weekday vs weekend averages
  const weekdayDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const weekendDays = ['Sat', 'Sun'];

  const weekdaySum = weekdayDays.reduce((sum, d) => sum + dayRates[d], 0);
  const weekendSum = weekendDays.reduce((sum, d) => sum + dayRates[d], 0);

  return {
    bestDay,
    worstDay,
    weekdayAvg: Math.round(weekdaySum / 5),
    weekendAvg: Math.round(weekendSum / 2),
  };
}

/**
 * Get recent non-empty reflections (last N days)
 */
function getRecentReflections(
  dailyData: Record<string, DailyData>,
  days: number = 7,
  fromDate: string = getToday()
): string[] {
  const dates = getDateRange(days, fromDate);
  const reflections: string[] = [];

  for (const date of dates) {
    const day = dailyData[date];
    if (day?.reflection && day.reflection.trim().length > 0) {
      // Truncate long reflections to save tokens
      const truncated =
        day.reflection.length > 100 ? day.reflection.slice(0, 100) + '...' : day.reflection;
      reflections.push(truncated);
    }
  }

  return reflections;
}

/**
 * Compute all analytics for AI insights
 */
export function computeHistoricalAnalytics(
  dailyData: Record<string, DailyData>,
  habits: HabitDefinition[],
  days: number = 30,
  fromDate: string = getToday()
): HistoricalAnalytics {
  return {
    periodDays: days,
    habits: computeHabitAnalytics(dailyData, habits, days, fromDate),
    correlations: computeCorrelations(dailyData, habits, days, fromDate),
    dayPatterns: computeDayPatterns(dailyData, habits, days, fromDate),
    recentReflections: getRecentReflections(dailyData, 7, fromDate),
  };
}
