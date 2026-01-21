/**
 * Pack Create Modal
 *
 * Create a new pack with label and total count.
 */

import { useState, useEffect, useRef } from 'react';

interface PackCreateModalProps {
  onSubmit: (label: string, total: number) => Promise<void>;
  onClose: () => void;
}

export function PackCreateModal({ onSubmit, onClose }: PackCreateModalProps) {
  const [label, setLabel] = useState('');
  const [total, setTotal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  // Focus label input on mount
  useEffect(() => {
    labelRef.current?.focus();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className="bg-bg-card border border-border rounded shadow-lg p-4 w-full max-w-sm mx-4"
        role="dialog"
        aria-label="Create new pack"
      >
        {/* Header */}
        <div className="text-sm font-medium text-text uppercase tracking-wide mb-4">
          new pack
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Label input */}
          <div>
            <label className="block text-xs text-text-muted font-mono mb-1">
              label
            </label>
            <input
              ref={labelRef}
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g., trainer sessions"
              className="w-full px-3 py-2 bg-bg border border-border rounded text-sm text-text font-mono placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {/* Total input */}
          <div>
            <label className="block text-xs text-text-muted font-mono mb-1">
              total sessions
            </label>
            <input
              type="number"
              min="1"
              value={total}
              onChange={e => setTotal(e.target.value)}
              placeholder="e.g., 48"
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
              disabled={submitting || !isValid}
              className="px-3 py-1.5 text-sm bg-accent text-bg rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? '...' : 'create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
