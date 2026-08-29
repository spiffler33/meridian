/**
 * Reflection
 *
 * Daily notes. Auto-saves. Minimal.
 */

import { useState, useEffect, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { Section } from './Section';

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

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value);
  }, []);

  const charCount = localValue.length;
  const isSaving = localValue !== value;

  return (
    <Section
      label="thoughts"
      aside={
        <span className="text-xs text-text-muted tabular-nums">
          {isSaving ? 'saving' : charCount > 0 ? `${charCount}` : ''}
        </span>
      }
    >
      <textarea
        value={localValue}
        onChange={handleChange}
        placeholder="what's on your mind?"
        className="w-full h-28 font-read text-base text-text bg-transparent rounded p-0 resize-none placeholder:text-text-muted"
      />
    </Section>
  );
}
