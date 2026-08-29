/**
 * Pack History Modal
 *
 * View all sessions for a pack.
 * Shows date + note for each session.
 * Allows removing sessions and archiving the pack.
 */

import { useState, useEffect } from 'react';
import type { PackWithCount, PackSession } from '../types';
import { getPackSessions } from '../services/data';
import { ModalShell, MODAL_DISMISS_BUTTON } from './ModalShell';

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
    <ModalShell title={pack.label} label={`History for ${pack.label}`} onClose={onClose} size="md">
      {/* Stats */}
      <div className="text-xs text-text-muted mb-4 tabular-nums">
        {pack.used}/{pack.total} sessions ({percentage}%)
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto min-h-0 mb-4">
        {loading ? (
          <div className="text-xs text-text-muted py-2">loading</div>
        ) : sessions.length === 0 ? (
          <div className="text-xs text-text-muted py-2">no sessions logged yet</div>
        ) : (
          <div className="space-y-2">
            {sessions.map(session => (
              <div
                key={session.id}
                className="flex items-start gap-2 px-3 py-2 rounded border border-border bg-bg text-sm"
              >
                {/* Date */}
                <span className="text-xs text-text-muted flex-shrink-0 tabular-nums">
                  {formatDate(session.date)}
                </span>

                {/* Note */}
                <span className="flex-1 text-text-secondary truncate">
                  {session.note || '-'}
                </span>

                {/* Remove button */}
                <button
                  onClick={() => handleRemoveSession(session.id)}
                  className="text-text-muted hover:text-error transition-colors flex-shrink-0 text-xs"
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
          className="text-xs text-text-muted hover:text-error transition-colors disabled:opacity-50"
        >
          {archiving ? 'archiving...' : 'archive pack'}
        </button>
        <button onClick={onClose} className={MODAL_DISMISS_BUTTON}>
          close
        </button>
      </div>
    </ModalShell>
  );
}

// Format date as "Jan 21" style
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
