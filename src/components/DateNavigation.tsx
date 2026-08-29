/**
 * Date Navigation
 *
 * Minimal date display with prev/next.
 */

import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { StepNav } from './StepNav';
import { formatDisplayDate, isToday, isFuture } from '../utils/dates';

interface DateNavigationProps {
  selectedDate: string;
  onPrevious: () => void;
  onNext: () => void;
  onDateSelect: (date: string) => void;
}

export function DateNavigation({
  selectedDate,
  onPrevious,
  onNext,
  onDateSelect,
}: DateNavigationProps) {
  const [showPicker, setShowPicker] = useState(false);

  const handleDateChange = (e: ChangeEvent<HTMLInputElement>) => {
    onDateSelect(e.target.value);
    setShowPicker(false);
  };

  const displayDate = formatDisplayDate(selectedDate);
  const todayIndicator = isToday(selectedDate);
  const futureIndicator = isFuture(selectedDate);

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-medium text-text">
          {displayDate}
        </h2>
        {todayIndicator && (
          <span className="text-xs text-accent font-mono">today</span>
        )}
        {futureIndicator && (
          <span className="text-xs text-text-muted font-mono">future</span>
        )}
      </div>

      {/* The picker rides between the two arrows, which is where it already sat. */}
      <StepNav onPrev={onPrevious} onNext={onNext} label="day">
        <div className="relative">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="p-2 text-text-muted hover:text-text transition-colors text-xs"
            aria-label="select date"
          >
            ···
          </button>

          {showPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPicker(false)} />
              <div className="absolute right-0 top-full mt-1 z-20">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={handleDateChange}
                  className="px-2 py-1 rounded border border-border bg-bg-card text-sm text-text focus:outline-none focus:border-accent"
                  autoFocus
                />
              </div>
            </>
          )}
        </div>
      </StepNav>
    </div>
  );
}
