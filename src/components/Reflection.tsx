/**
 * Reflection Component
 *
 * A simple text area for daily journaling.
 * Auto-saves as you type (debounced).
 */

import React, { useState, useEffect, useCallback } from 'react';

interface ReflectionProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// Debounce hook for auto-save
function useDebounce(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function Reflection({ value, onChange, placeholder }: ReflectionProps) {
  const [localValue, setLocalValue] = useState(value);
  const debouncedValue = useDebounce(localValue, 500);

  // Sync local value when prop changes (e.g., navigating to different day)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Save when debounced value changes
  useEffect(() => {
    if (debouncedValue !== value) {
      onChange(debouncedValue);
    }
  }, [debouncedValue, value, onChange]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value);
  }, []);

  const charCount = localValue.length;
  const isSaving = localValue !== value;

  return (
    <div className="bg-white rounded-xl border border-surface-200 p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-surface-800">Reflection</h3>
        <div className="text-xs text-surface-400">
          {isSaving ? 'Saving...' : charCount > 0 ? `${charCount} chars` : ''}
        </div>
      </div>

      {/* Text area */}
      <textarea
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder || 'How did today go? What did you learn? What are you grateful for?'}
        className="w-full h-32 text-sm text-surface-700 bg-surface-50 rounded-lg p-3 border border-surface-100 focus:border-accent-300 focus:ring-1 focus:ring-accent-300 outline-none resize-none placeholder:text-surface-400"
      />

      {/* Prompts - subtle hints */}
      <div className="mt-2 text-xs text-surface-400">
        <span>One win today • One learning • One gratitude</span>
      </div>
    </div>
  );
}
