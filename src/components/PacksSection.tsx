/**
 * Packs Section
 *
 * Finite counters with optional session notes.
 * "12/48 trainer sessions used"
 *
 * Visual: progress bar + count + log button
 */

import { useState } from 'react';
import type { PackWithCount } from '../types';
import { PackLogModal } from './PackLogModal';
import { PackHistoryModal } from './PackHistoryModal';
import { PackCreateModal } from './PackCreateModal';

interface PacksSectionProps {
  packs: PackWithCount[];
  onLogSession: (packId: string, date: string, note?: string) => Promise<void>;
  onRemoveSession: (packId: string, sessionId: string) => Promise<void>;
  onCreatePack: (label: string, total: number) => Promise<void>;
  onArchivePack: (packId: string) => Promise<void>;
}

interface PackRowProps {
  pack: PackWithCount;
  onLog: () => void;
  onViewHistory: () => void;
}

function ProgressBar({ used, total }: { used: number; total: number }) {
  // Use 12 segments for visual display (matches plan: ████████░░░░)
  const segments = 12;
  const filled = Math.min(Math.round((used / total) * segments), segments);
  const empty = segments - filled;

  return (
    <span className="font-mono text-xs text-text-muted">
      <span className="text-accent">{'█'.repeat(filled)}</span>
      <span className="opacity-40">{'░'.repeat(empty)}</span>
    </span>
  );
}

function PackRow({ pack, onLog, onViewHistory }: PackRowProps) {
  const isComplete = pack.used >= pack.total;
  const percentage = Math.min(Math.round((pack.used / pack.total) * 100), 100);

  return (
    <div
      className={`
        flex items-center gap-3 px-3 py-2 rounded border text-sm transition-all
        ${isComplete
          ? 'border-accent/50 bg-accent/5 text-text'
          : 'border-border bg-bg-card text-text-secondary hover:border-border-focus'
        }
      `}
    >
      {/* Label - clickable for history */}
      <button
        onClick={onViewHistory}
        className="truncate flex-1 text-left hover:text-text transition-colors"
        title={`${pack.used}/${pack.total} used (${percentage}%)`}
      >
        {pack.label}
      </button>

      {/* Progress bar */}
      <ProgressBar used={pack.used} total={pack.total} />

      {/* Count */}
      <span className="text-xs text-text-muted font-mono flex-shrink-0 w-12 text-right">
        {pack.used}/{pack.total}
      </span>

      {/* Log button */}
      {!isComplete && (
        <button
          onClick={onLog}
          className="text-accent hover:opacity-80 transition-opacity flex-shrink-0"
          aria-label={`Log session for ${pack.label}`}
        >
          +
        </button>
      )}
      {isComplete && (
        <span className="text-accent flex-shrink-0" aria-label="Complete">
          ●
        </span>
      )}
    </div>
  );
}

export function PacksSection({
  packs,
  onLogSession,
  onRemoveSession,
  onCreatePack,
  onArchivePack,
}: PacksSectionProps) {
  const [logModalPack, setLogModalPack] = useState<PackWithCount | null>(null);
  const [historyModalPack, setHistoryModalPack] = useState<PackWithCount | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleLogSession = async (date: string, note?: string) => {
    if (!logModalPack) return;
    await onLogSession(logModalPack.id, date, note);
    setLogModalPack(null);
  };

  const handleRemoveSession = async (sessionId: string) => {
    if (!historyModalPack) return;
    await onRemoveSession(historyModalPack.id, sessionId);
  };

  const handleCreatePack = async (label: string, total: number) => {
    await onCreatePack(label, total);
    setShowCreateModal(false);
  };

  const handleArchivePack = async () => {
    if (!historyModalPack) return;
    await onArchivePack(historyModalPack.id);
    setHistoryModalPack(null);
  };

  // Don't render section if no packs and we're not showing create modal
  // But always show the header with add button
  return (
    <div className="bg-bg-card rounded border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
          packs
        </span>
        <button
          onClick={() => setShowCreateModal(true)}
          className="text-xs text-accent hover:opacity-80 transition-opacity font-mono"
          aria-label="Create new pack"
        >
          + new
        </button>
      </div>

      {packs.length === 0 ? (
        <div className="text-xs text-text-muted font-mono py-2">
          no active packs
        </div>
      ) : (
        <div className="space-y-2">
          {packs.map(pack => (
            <PackRow
              key={pack.id}
              pack={pack}
              onLog={() => setLogModalPack(pack)}
              onViewHistory={() => setHistoryModalPack(pack)}
            />
          ))}
        </div>
      )}

      {/* Log Modal */}
      {logModalPack && (
        <PackLogModal
          pack={logModalPack}
          onSubmit={handleLogSession}
          onClose={() => setLogModalPack(null)}
        />
      )}

      {/* History Modal */}
      {historyModalPack && (
        <PackHistoryModal
          pack={historyModalPack}
          onRemoveSession={handleRemoveSession}
          onArchive={handleArchivePack}
          onClose={() => setHistoryModalPack(null)}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <PackCreateModal
          onSubmit={handleCreatePack}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
