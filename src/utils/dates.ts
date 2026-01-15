/**
 * Date Utility Functions
 *
 * All date operations for the Life Calendar.
 * Uses native Date objects - no external dependencies.
 */

/**
 * Format a Date object as YYYY-MM-DD (our canonical date format).
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a YYYY-MM-DD string into a Date object.
 */
export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Get today's date as YYYY-MM-DD.
 */
export function getToday(): string {
  return formatDate(new Date());
}

/**
 * Add days to a date string, returning a new date string.
 */
export function addDays(dateStr: string, days: number): string {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

/**
 * Format a date for display (e.g., "Thursday, 15 January 2026").
 */
export function formatDisplayDate(dateStr: string): string {
  const date = parseDate(dateStr);
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Format a short date for display (e.g., "15 Jan").
 */
export function formatShortDate(dateStr: string): string {
  const date = parseDate(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Get the day of week as a short string (e.g., "Mon").
 */
export function getDayOfWeek(dateStr: string): string {
  const date = parseDate(dateStr);
  return date.toLocaleDateString('en-GB', { weekday: 'short' });
}

/**
 * Get the week number of the year for a given date.
 */
export function getWeekNumber(dateStr: string): number {
  const date = parseDate(dateStr);
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

/**
 * Get all dates in a week containing the given date.
 * @param dateStr - Any date in the week
 * @param weekStartsOn - 0 for Sunday, 1 for Monday
 */
export function getWeekDates(dateStr: string, weekStartsOn: 0 | 1 = 1): string[] {
  const date = parseDate(dateStr);
  const dayOfWeek = date.getDay();

  // Calculate days to subtract to get to the start of the week
  let daysToSubtract: number;
  if (weekStartsOn === 1) {
    // Monday start
    daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  } else {
    // Sunday start
    daysToSubtract = dayOfWeek;
  }

  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysToSubtract);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    dates.push(formatDate(d));
  }

  return dates;
}

/**
 * Check if a date is today.
 */
export function isToday(dateStr: string): boolean {
  return dateStr === getToday();
}

/**
 * Check if a date is in the past.
 */
export function isPast(dateStr: string): boolean {
  return dateStr < getToday();
}

/**
 * Check if a date is in the future.
 */
export function isFuture(dateStr: string): boolean {
  return dateStr > getToday();
}

/**
 * Get the year from a date string.
 */
export function getYear(dateStr: string): number {
  return parseDate(dateStr).getFullYear();
}

/**
 * Get all dates in a year for the heatmap.
 * Returns an array of arrays, where each inner array is a week.
 * @param year - The year to get dates for
 * @param weekStartsOn - 0 for Sunday, 1 for Monday
 */
export function getYearCalendarGrid(year: number, weekStartsOn: 0 | 1 = 1): string[][] {
  const weeks: string[][] = [];

  // Start from the first day of the year
  let current = new Date(year, 0, 1);

  // Adjust to the start of that week
  const firstDayOfWeek = current.getDay();
  let daysToSubtract: number;
  if (weekStartsOn === 1) {
    daysToSubtract = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
  } else {
    daysToSubtract = firstDayOfWeek;
  }
  current.setDate(current.getDate() - daysToSubtract);

  // Generate weeks until we're past the year
  while (current.getFullYear() <= year) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = formatDate(current);
      // Only include dates from the target year
      if (current.getFullYear() === year) {
        week.push(dateStr);
      } else {
        week.push(''); // Empty placeholder for dates outside the year
      }
      current.setDate(current.getDate() + 1);
    }

    // Only add the week if it has at least one date from the year
    if (week.some(d => d !== '')) {
      weeks.push(week);
    }
  }

  return weeks;
}

/**
 * Get the month abbreviation for display (e.g., "Jan", "Feb").
 */
export function getMonthAbbr(month: number): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month];
}
