/**
 * Pack Create Modal
 *
 * Create a new pack with label and total count.
 */

import { useState, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import {
  ModalShell,
  MODAL_DISMISS_BUTTON,
  MODAL_CONFIRM_BUTTON,
  MODAL_FIELD,
} from './ModalShell';

interface PackCreateModalProps {
  onSubmit: (label: string, total: number) => Promise<void>;
  onClose: () => void;
}

export function PackCreateModal({ onSubmit, onClose }: PackCreateModalProps) {
  const [label, setLabel] = useState('');
  const [total, setTotal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  // Focus label input on mount
  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedLabel = label.trim();
    const totalNum = parseInt(total, 10);

    if (!trimmedLabel || !totalNum || totalNum <= 0) return;

    setSubmitting(true);
    try {
      await onSubmit(trimmedLabel, totalNum);
    } finally {
      setSubmitting(false);
    }
  };

  const isValid = label.trim() && parseInt(total, 10) > 0;

  return (
    <ModalShell title="new pack" label="Create new pack" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Label input */}
        <div>
          <label className="block text-xs text-text-muted mb-1">
            label
          </label>
          <input
            ref={labelRef}
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g., trainer sessions"
            className={MODAL_FIELD}
          />
        </div>

        {/* Total input */}
        <div>
          <label className="block text-xs text-text-muted mb-1">
            total sessions
          </label>
          <input
            type="number"
            min="1"
            value={total}
            onChange={e => setTotal(e.target.value)}
            placeholder="e.g., 48"
            className={`${MODAL_FIELD} tabular-nums`}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={MODAL_DISMISS_BUTTON}>
            cancel
          </button>
          <button type="submit" disabled={submitting || !isValid} className={MODAL_CONFIRM_BUTTON}>
            {submitting ? '...' : 'create'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
