/**
 * Reflection
 *
 * Daily notes. Auto-saves. Minimal.
 */

import React, { useState, useEffect, useCallback } from 'react';

interface ReflectionProps {
  value: string;
  onChange: (value: string) => void;
}

function useDebounce(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function Reflection({ value, onChange }: ReflectionProps) {
  const [localValue, setLocalValue] = useState(value);
  const debouncedValue = useDebounce(localValue, 500);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

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
    <div className="bg-bg-card rounded border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
          thoughts
        </span>
        <span className="text-xs text-text-muted font-mono">
          {isSaving ? 'saving' : charCount > 0 ? `${charCount}` : ''}
        </span>
      </div>

      <textarea
        value={localValue}
        onChange={handleChange}
        placeholder="what's on your mind?"
        className="w-full h-28 text-sm text-text bg-transparent rounded p-0 border-none focus:ring-0 outline-none resize-none placeholder:text-text-muted"
      />
    </div>
  );
}
