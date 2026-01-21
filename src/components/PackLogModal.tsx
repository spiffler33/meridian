/**
 * Pack Log Modal
 *
 * Log a session for a pack.
 * Simple form: date (defaults to today) + optional note.
 */

import { useState, useEffect, useRef } from 'react';
import type { PackWithCount } from '../types';
import { getToday } from '../utils/dates';

interface PackLogModalProps {
  pack: PackWithCount;
  onSubmit: (date: string, note?: string) => Promise<void>;
  onClose: () => void;
}

export function PackLogModal({ pack, onSubmit, onClose }: PackLogModalProps) {
  const [date, setDate] = useState(getToday());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  // Focus note input on mount
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  // Close on escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      await onSubmit(date, note.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className="bg-bg-card border border-border rounded shadow-lg p-4 w-full max-w-sm mx-4"
        role="dialog"
        aria-label={`Log session for ${pack.label}`}
      >
        {/* Header */}
        <div className="text-sm font-medium text-text uppercase tracking-wide mb-4">
          log session
        </div>

        {/* Pack info */}
        <div className="text-xs text-text-muted font-mono mb-4">
          {pack.label} ({pack.used}/{pack.total})
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Date input */}
          <div>
            <label className="block text-xs text-text-muted font-mono mb-1">
              date
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded text-sm text-text font-mono focus:border-accent focus:outline-none"
            />
          </div>

          {/* Note input */}
          <div>
            <label className="block text-xs text-text-muted font-mono mb-1">
              note (optional)
            </label>
            <input
              ref={noteRef}
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g., Deadlift PR 80kg"
              className="w-full px-3 py-2 bg-bg border border-border rounded text-sm text-text font-mono placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text transition-colors"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 text-sm bg-accent text-bg rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? '...' : 'log'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
