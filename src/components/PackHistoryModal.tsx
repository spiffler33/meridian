/**
 * Pack History Modal
 *
 * View all sessions for a pack.
 * Shows date + note for each session.
 * Allows removing sessions and archiving the pack.
 */

import { useState, useEffect, useRef } from 'react';
import type { PackWithCount, PackSession } from '../types';
import { getPackSessions } from '../services/data';

interface PackHistoryModalProps {
  pack: PackWithCount;
  onRemoveSession: (sessionId: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onClose: () => void;
}

export function PackHistoryModal({
  pack,
  onRemoveSession,
  onArchive,
  onClose,
}: PackHistoryModalProps) {
  const [sessions, setSessions] = useState<PackSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Load sessions on mount
  useEffect(() => {
    async function loadSessions() {
      try {
        const data = await getPackSessions(pack.id);
        setSessions(data);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to load pack sessions:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSessions();
  }, [pack.id]);

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

  const handleRemoveSession = async (sessionId: string) => {
    await onRemoveSession(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  const handleArchive = async () => {
    if (archiving) return;
    setArchiving(true);
    try {
      await onArchive();
    } finally {
      setArchiving(false);
    }
  };

  const percentage = Math.min(Math.round((pack.used / pack.total) * 100), 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={modalRef}
        className="bg-bg-card border border-border rounded shadow-lg p-4 w-full max-w-md mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-label={`History for ${pack.label}`}
      >
        {/* Header */}
        <div className="text-sm font-medium text-text uppercase tracking-wide mb-2">
          {pack.label}
        </div>

        {/* Stats */}
        <div className="text-xs text-text-muted font-mono mb-4">
          {pack.used}/{pack.total} sessions ({percentage}%)
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto min-h-0 mb-4">
          {loading ? (
            <div className="text-xs text-text-muted font-mono py-4 text-center">
              loading...
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-xs text-text-muted font-mono py-4 text-center">
              no sessions logged yet
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map(session => (
                <div
                  key={session.id}
                  className="flex items-start gap-2 px-3 py-2 rounded border border-border bg-bg text-sm"
                >
                  {/* Date */}
                  <span className="text-xs text-text-muted font-mono flex-shrink-0">
                    {formatDate(session.date)}
                  </span>

                  {/* Note */}
                  <span className="flex-1 text-text-secondary truncate">
                    {session.note || '-'}
                  </span>

                  {/* Remove button */}
                  <button
                    onClick={() => handleRemoveSession(session.id)}
                    className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0 text-xs"
                    aria-label="Remove session"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-border">
          <button
            onClick={handleArchive}
            disabled={archiving}
            className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {archiving ? 'archiving...' : 'archive pack'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-text-secondary hover:text-text transition-colors"
          >
            close
          </button>
        </div>
      </div>
    </div>
  );
}

// Format date as "Jan 21" style
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
