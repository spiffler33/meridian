/**
 * Pack Log Modal
 *
 * Log a session for a pack.
 * Simple form: date (defaults to today) + optional note.
 */

import { useState, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import type { PackWithCount } from '../types';
import { getToday } from '../utils/dates';
import {
  ModalShell,
  MODAL_DISMISS_BUTTON,
  MODAL_CONFIRM_BUTTON,
  MODAL_FIELD,
} from './ModalShell';

interface PackLogModalProps {
  pack: PackWithCount;
  onSubmit: (date: string, note?: string) => Promise<void>;
  onClose: () => void;
}

export function PackLogModal({ pack, onSubmit, onClose }: PackLogModalProps) {
  const [date, setDate] = useState(getToday());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);

  // Focus note input on mount
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
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
    <ModalShell title="log session" label={`Log session for ${pack.label}`} onClose={onClose}>
      {/* Pack info */}
      <div className="text-xs text-text-muted mb-4">
        {pack.label} <span className="tabular-nums">({pack.used}/{pack.total})</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Date input */}
        <div>
          <label className="block text-xs text-text-muted mb-1">
            date
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className={`${MODAL_FIELD} tabular-nums`}
          />
        </div>

        {/* Note input */}
        <div>
          <label className="block text-xs text-text-muted mb-1">
            note (optional)
          </label>
          <input
            ref={noteRef}
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g., deadlift PR 80kg"
            className={MODAL_FIELD}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={MODAL_DISMISS_BUTTON}>
            cancel
          </button>
          <button type="submit" disabled={submitting} className={MODAL_CONFIRM_BUTTON}>
            {submitting ? '...' : 'log'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
