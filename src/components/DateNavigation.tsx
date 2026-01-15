/**
 * Date Navigation Component
 *
 * Shows the current date with prev/next buttons and a date picker.
 */

import React, { useState } from 'react';
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

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onDateSelect(e.target.value);
    setShowPicker(false);
  };

  const displayDate = formatDisplayDate(selectedDate);
  const todayIndicator = isToday(selectedDate);
  const futureIndicator = isFuture(selectedDate);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      {/* Date display */}
      <div className="flex items-center gap-3">
        <h2 className="text-xl sm:text-2xl font-semibold text-surface-800">
          {displayDate}
        </h2>
        {todayIndicator && (
          <span className="px-2 py-0.5 text-xs font-medium bg-accent-100 text-accent-700 rounded-full">
            Today
          </span>
        )}
        {futureIndicator && (
          <span className="px-2 py-0.5 text-xs font-medium bg-surface-100 text-surface-600 rounded-full">
            Future
          </span>
        )}
      </div>

      {/* Navigation controls */}
      <div className="flex items-center gap-2">
        {/* Previous day */}
        <button
          onClick={onPrevious}
          className="p-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors"
          aria-label="Previous day"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Date picker toggle */}
        <div className="relative">
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="p-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors"
            aria-label="Select date"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </button>

          {/* Native date picker */}
          {showPicker && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowPicker(false)}
              />
              <div className="absolute right-0 top-full mt-2 z-20">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={handleDateChange}
                  className="px-3 py-2 rounded-lg border border-surface-200 bg-white shadow-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                  autoFocus
                />
              </div>
            </>
          )}
        </div>

        {/* Next day */}
        <button
          onClick={onNext}
          className="p-2 rounded-lg border border-surface-200 text-surface-600 hover:bg-surface-100 transition-colors"
          aria-label="Next day"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
