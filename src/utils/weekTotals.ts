/**
 * The week in three numbers.
 *
 * Here rather than in the week view because two things say them: the collapsed
 * summary row on the Year view, and the week itself when it is open. One
 * arithmetic in one place, so the line and the cards under it can never
 * disagree.
 */

import type { DailyData } from '../types';

interface WeekTotals {
  totalMits: number;
  completedMits: number;
  daysWithNotes: number;
}

export function weekTotals(
  dates: readonly string[],
  getDailyData: (date: string) => DailyData
): WeekTotals {
  let totalMits = 0;
  let completedMits = 0;
  let daysWithNotes = 0;

  for (const date of dates) {
    const dayData = getDailyData(date);
    totalMits += dayData.mit.work.length + dayData.mit.self.length + dayData.mit.family.length;
    completedMits +=
      dayData.mit.work.filter(i => i.completed).length +
      dayData.mit.self.filter(i => i.completed).length +
      dayData.mit.family.filter(i => i.completed).length;
    if (dayData.reflection.length > 0) daysWithNotes += 1;
  }

  return { totalMits, completedMits, daysWithNotes };
}
