/**
 * Daily Inspiration
 *
 * Naval quote + goal countdown. Minimal, stoic.
 * Shows rest-themed quotes on holiday days.
 */

import { getDailyQuote } from '../data/navalQuotes';
import { getRestQuote } from '../data/restQuotes';
import { getDaysUntilEndOfYear, parseDate } from '../utils/dates';

interface DailyInspirationProps {
  selectedDate: string;
  isHoliday?: boolean;
}

export function DailyInspiration({ selectedDate, isHoliday }: DailyInspirationProps) {
  const date = parseDate(selectedDate);
  const quote = isHoliday ? getRestQuote(date) : getDailyQuote(date);
  const daysLeft = getDaysUntilEndOfYear(selectedDate);

  return (
    <div className="space-y-2">
      {/* Quote */}
      <blockquote className="font-read text-base text-text-secondary border-l-2 border-border pl-3">
        "{quote}"
        {!isHoliday && (
          <cite className="block font-mono text-xs text-text-muted mt-1">— Naval</cite>
        )}
      </blockquote>

      {/* Countdown */}
      {daysLeft > 0 && (
        <div className="text-xs text-text-muted tabular-nums">
          {daysLeft} days left this year
        </div>
      )}
    </div>
  );
}
