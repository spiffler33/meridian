/**
 * Tower View - Attention Steering Interface
 *
 * Surfaces what needs attention now, hides the rest accountably.
 * Core loop: Open -> See 1-3 items -> Act or Hold -> Trust the system
 */

import { useCallback, useState } from 'react';
import { useApp } from '../store/AppContext';
import { TwoMinuteTimer } from '../components/TwoMinuteTimer';
import { Chip } from '../components/Chip';
import { DayShape } from '../components/DayShape';
import { Dock } from '../components/Dock';
import { deviceTimeZone } from '../lib/calendar';
import { effectKey, updateTaskChipLabel } from '../lib/pulse';
import { useTowerPulses } from '../hooks/useTowerPulses';
import type { TowerPulses } from '../hooks/useTowerPulses';
import { getToday } from '../utils/dates';
import type { CalendarMirror } from '../lib/calendar';
import type { TowerItem } from '../types';

export default function TowerView({ mirror }: { mirror: CalendarMirror | null }) {
  const {
    state,
    completeTowerItemById,
    updateTowerItemById,
    deleteTowerItemById,
  } = useApp();

  // The pulse half of this page: a submission is also an utterance, and the
  // coder's answer comes back as proposals on the items it names.
  const pulses = useTowerPulses();

  const today = getToday();
  const timeZone = deviceTimeZone();
  const [captureText, setCaptureText] = useState('');
  const [timerItemId, setTimerItemId] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);

  // Group and sort items by status with smart prioritization
  const activeItems = sortByUrgency(state.tower.filter(i => i.status === 'active'));
  const waitingItems = state.tower.filter(i => i.status === 'waiting');
  const somedayItems = state.tower.filter(i => i.status === 'someday');

  // The hero item (first active)
  const nowItem = activeItems[0];
  // Queue (next 2 active items)
  const queueItems = activeItems.slice(1, 3);
  // Overflow (remaining active items beyond first 3)
  const overflowItems = activeItems.slice(3);

  /**
   * Add immediately — zero-friction capture, unchanged from the owner's side.
   *
   * There is no parse and no model between Enter and the item: the line IS the
   * task, as it always was. The same submission also becomes a pulse, in one
   * commit, and the coder runs on that pulse afterwards — fired, never awaited
   * (fence 3), so a dead or slow coder costs the item nothing.
   *
   * The text comes back if the write failed. One commit means both halves
   * failed together, so there is nothing saved anywhere and the sentence would
   * otherwise be gone: the old fallback here could never run, because the
   * provider it called swallowed its own errors.
   */
  const handleCapture = useCallback(async () => {
    const text = captureText.trim();
    if (!text || isCapturing) return;

    setIsCapturing(true);
    setCaptureText('');

    const saved = await pulses.capture(text);
    if (!saved) setCaptureText(text);
    setIsCapturing(false);
  }, [captureText, isCapturing, pulses]);

  const handleComplete = useCallback(async (id: string) => {
    await completeTowerItemById(id);
  }, [completeTowerItemById]);

  const handleHold = useCallback(async (id: string, waitingOn?: string) => {
    await updateTowerItemById(id, {
      status: 'waiting',
      waitingOn: waitingOn || 'unspecified',
    });
  }, [updateTowerItemById]);

  const handleSomeday = useCallback(async (id: string) => {
    await updateTowerItemById(id, { status: 'someday' });
  }, [updateTowerItemById]);

  const handleReactivate = useCallback(async (id: string) => {
    await updateTowerItemById(id, {
      status: 'active',
      waitingOn: undefined,
    });
  }, [updateTowerItemById]);

  const handleEdit = useCallback(async (id: string, text: string) => {
    await updateTowerItemById(id, { text });
  }, [updateTowerItemById]);

  const handleStartTimer = useCallback((id: string) => {
    setTimerItemId(id);
  }, []);

  const handleTimerComplete = useCallback(async () => {
    if (timerItemId) {
      await completeTowerItemById(timerItemId);
    }
    setTimerItemId(null);
  }, [timerItemId, completeTowerItemById]);

  const handleTimerStop = useCallback(() => {
    setTimerItemId(null);
  }, []);

  // Find the item being timed (for timer display)
  const timerItem = timerItemId ? state.tower.find(i => i.id === timerItemId) : null;

  return (
    <div className="space-y-6">
      {/* What the day already has in it, before anything is chosen for it. */}
      {/*
        `Date.now()` in render is impure and the rule is right about it. It is
        pre-existing and not this stage's to change: `now` decides which event
        DayShape lights as next and whether the mirror reads stale, so sampling
        it at mount instead would freeze both on a page left open. The real fix
        is DayShape owning its own clock, which is a change to DayShape.
        Reported rather than silently re-hidden: it was invisible only because
        the compiler bails out of a component containing `try`, and this file's
        capture handler no longer needs one.
      */}
      {/* eslint-disable-next-line react-hooks/purity */}
      <DayShape mirror={mirror} date={today} timeZone={timeZone} now={Date.now()} />

      {/* NOW Section - Hero Item */}
      <section>
        <h2 className="text-xs uppercase tracking-widest text-text-muted mb-3">
          Now
        </h2>

        {nowItem ? (
          <NowCard
            item={nowItem}
            onComplete={() => handleComplete(nowItem.id)}
            onHold={(waitingOn) => handleHold(nowItem.id, waitingOn)}
            onSomeday={() => handleSomeday(nowItem.id)}
            onStartTimer={() => handleStartTimer(nowItem.id)}
            isTimerRunning={timerItemId === nowItem.id}
            onEdit={(text) => handleEdit(nowItem.id, text)}
            pulses={pulses}
          />
        ) : (
          <div className="text-text-muted text-sm py-8 text-center border border-dashed border-border rounded">
            Nothing needs attention right now
          </div>
        )}
      </section>

      {/* Queue - Next items */}
      {queueItems.length > 0 && (
        <section>
          <QueueList
            items={queueItems}
            onComplete={handleComplete}
            pulses={pulses}
          />
        </section>
      )}

      {/* Overflow - Hidden items with expand option */}
      {overflowItems.length > 0 && (
        <section className="ml-2">
          <button
            onClick={() => setShowOverflow(!showOverflow)}
            className="text-xs text-text-muted hover:text-accent transition-colors"
          >
            {showOverflow ? '[-] hide' : `[+${overflowItems.length} more]`}
          </button>
          {showOverflow && (
            <div className="mt-2">
              <QueueList
                items={overflowItems}
                onComplete={handleComplete}
                pulses={pulses}
              />
            </div>
          )}
        </section>
      )}

      {/* Follow Up (blocked items) */}
      {waitingItems.length > 0 && (
        <FollowUpSection
          items={waitingItems}
          onReactivate={handleReactivate}
        />
      )}

      {/* Someday */}
      <SomedaySection
        items={somedayItems}
        onReactivate={handleReactivate}
        onDelete={deleteTowerItemById}
      />

      {/* Docked at the foot of the screen, above the backup line rather than
          underneath it — which is what `fixed` was doing to its placeholder. */}
      <Dock>
        <CaptureInput
          value={captureText}
          onChange={setCaptureText}
          onSubmit={handleCapture}
          isCapturing={isCapturing}
        />
      </Dock>

      {/* Two Minute Timer */}
      {timerItem && (
        <TwoMinuteTimer
          taskName={timerItem.text}
          onComplete={handleTimerComplete}
          onStop={handleTimerStop}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * The coder's proposals about one item.
 *
 * Nothing renders when an item has none, which is nearly all of them at any
 * moment — an empty row under every task would turn a page built for a glance
 * into a form. The label says only what would CHANGE: the task is the line
 * directly above it, so naming it again is noise here (the pulse line, where
 * the task is not on screen, spells it out instead).
 *
 * Shown on the items this page actually surfaces — Now, the queue, the
 * overflow. A proposal on a followed-up or someday item stays reachable on its
 * own pulse line rather than being buried in a drawer nothing opens; Tower is
 * a quick page for what needs doing, and a chip that is never seen is worse
 * than a chip that lives in one place.
 */
function ItemProposals({
  itemId,
  pulses,
  className,
}: {
  itemId: string;
  pulses: TowerPulses;
  className: string;
}) {
  const proposals = pulses.proposals[itemId] ?? [];
  if (proposals.length === 0) return null;

  return (
    <div className={className}>
      {proposals.map((proposal) => (
        <Chip
          // The proposal itself, never its position: acting on one shifts the
          // rest down, and React would then reuse the node of the chip that
          // was there. Two lines can propose the same change, so the pulse
          // that said it is part of the identity.
          key={`${proposal.pulseId}:${effectKey(proposal.effect)}`}
          label={updateTaskChipLabel(proposal.effect)}
          onApply={() => pulses.apply(proposal)}
          onDismiss={() => pulses.dismiss(proposal)}
        />
      ))}
    </div>
  );
}

interface NowCardProps {
  item: TowerItem;
  onComplete: () => void;
  onHold: (waitingOn?: string) => void;
  onSomeday: () => void;
  onStartTimer: () => void;
  isTimerRunning: boolean;
  pulses: TowerPulses;
}

function NowCard({ item, onComplete, onHold, onSomeday, onStartTimer, isTimerRunning, onEdit, pulses }: NowCardProps & { onEdit: (text: string) => void }) {
  const [showHoldInput, setShowHoldInput] = useState(false);
  const [waitingOnText, setWaitingOnText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);

  const handleHoldSubmit = () => {
    onHold(waitingOnText || undefined);
    setShowHoldInput(false);
    setWaitingOnText('');
  };

  const handleEditSubmit = () => {
    if (editText.trim() && editText.trim() !== item.text) {
      onEdit(editText.trim());
    }
    setIsEditing(false);
  };

  const age = getAge(item.createdAt);

  return (
    <div className="bg-bg-card border border-accent/30 rounded p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-accent font-bold">&gt;</span>
        <div className="flex-1">
          {isEditing ? (
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleEditSubmit();
                if (e.key === 'Escape') {
                  setEditText(item.text);
                  setIsEditing(false);
                }
              }}
              onBlur={handleEditSubmit}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-text focus:outline-none focus:border-accent"
              autoFocus
            />
          ) : (
            <p
              className="text-text cursor-pointer hover:text-accent transition-colors"
              onClick={() => setIsEditing(true)}
              title="Click to edit"
            >
              {item.text}
            </p>
          )}
          <p className="text-xs text-text-muted mt-1">
            {item.expectsBy && `${formatDate(item.expectsBy, item.isEvent)} · `}
            {age && `added ${age}`}
            {item.effort && ` · ${item.effort}`}
          </p>
        </div>
      </div>

      {showHoldInput ? (
        <div className="flex gap-2 ml-6">
          <input
            type="text"
            value={waitingOnText}
            onChange={(e) => setWaitingOnText(e.target.value)}
            placeholder="waiting on..."
            className="flex-1 bg-bg border border-border rounded px-2 py-1 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleHoldSubmit();
              if (e.key === 'Escape') setShowHoldInput(false);
            }}
            autoFocus
          />
          <button
            onClick={handleHoldSubmit}
            className="text-xs text-accent hover:underline"
          >
            confirm
          </button>
        </div>
      ) : (
        <div className="flex gap-3 ml-6">
          <button
            onClick={onStartTimer}
            disabled={isTimerRunning}
            className={`text-xs transition-colors ${
              isTimerRunning
                ? 'text-accent'
                : 'text-text-secondary hover:text-accent'
            }`}
          >
            [2 min]
          </button>
          <button
            onClick={onComplete}
            className="text-xs text-text-secondary hover:text-accent transition-colors"
          >
            [done]
          </button>
          <button
            onClick={() => setShowHoldInput(true)}
            className="text-xs text-text-secondary hover:text-accent transition-colors"
          >
            [hold]
          </button>
          <button
            onClick={onSomeday}
            className="text-xs text-text-secondary hover:text-accent transition-colors"
          >
            [someday]
          </button>
        </div>
      )}

      <ItemProposals itemId={item.id} pulses={pulses} className="ml-6 flex flex-wrap items-center gap-2" />
    </div>
  );
}

interface QueueListProps {
  items: TowerItem[];
  onComplete: (id: string) => void;
  pulses: TowerPulses;
}

function QueueList({ items, onComplete, pulses }: QueueListProps) {
  return (
    <ul className="space-y-2 border-l-2 border-border pl-4 ml-2">
      {items.map((item) => (
        <li key={item.id} className="text-text-secondary group">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onComplete(item.id)}
              className="w-4 h-4 border border-border rounded-sm hover:border-accent transition-colors flex items-center justify-center"
              title="Mark done"
            >
              <span className="opacity-0 group-hover:opacity-100 text-xs text-accent">
                +
              </span>
            </button>
            <span className="text-sm">{item.text}</span>
            {item.expectsBy && (
              <span className="text-xs text-text-muted">· {formatDate(item.expectsBy, item.isEvent)}</span>
            )}
          </div>
          <ItemProposals itemId={item.id} pulses={pulses} className="mt-2 ml-7 flex flex-wrap items-center gap-2" />
        </li>
      ))}
    </ul>
  );
}

interface FollowUpSectionProps {
  items: TowerItem[];
  onReactivate: (id: string) => void;
}

function FollowUpSection({ items, onReactivate }: FollowUpSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border-t border-border pt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs uppercase tracking-widest text-text-muted hover:text-text-secondary transition-colors flex items-center gap-2"
      >
        <span>{expanded ? '[-]' : '[+]'}</span>
        Follow Up ({items.length})
      </button>

      {expanded && items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between text-text-muted text-sm group"
            >
              <div className="flex items-center gap-2">
                <span className="text-text-secondary">{item.text}</span>
                {item.waitingOn && (
                  <span className="text-xs">· {item.waitingOn}</span>
                )}
                {item.expectsBy && (
                  <span className="text-xs">· {formatDate(item.expectsBy)}</span>
                )}
              </div>
              <button
                onClick={() => onReactivate(item.id)}
                className="text-xs opacity-0 group-hover:opacity-100 text-accent hover:underline transition-opacity"
              >
                reactivate
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface SomedaySectionProps {
  items: TowerItem[];
  onReactivate: (id: string) => void;
  onDelete: (id: string) => void;
}

function SomedaySection({ items, onReactivate, onDelete }: SomedaySectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border-t border-border pt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs uppercase tracking-widest text-text-muted hover:text-text-secondary transition-colors flex items-center gap-2"
      >
        <span>{expanded ? '[-]' : '[+]'}</span>
        Someday ({items.length})
      </button>

      {expanded && items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between text-text-muted text-sm group"
            >
              <span>{item.text}</span>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onReactivate(item.id)}
                  className="text-xs text-accent hover:underline"
                >
                  activate
                </button>
                <button
                  onClick={() => onDelete(item.id)}
                  className="text-xs text-red-400 hover:underline"
                >
                  delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface CaptureInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isCapturing?: boolean;
}

function CaptureInput({ value, onChange, onSubmit, isCapturing }: CaptureInputProps) {
  return (
    <div className="border-t border-border py-3">
      <div className="flex gap-2">
        <span className="text-text-muted py-2">{isCapturing ? '+' : '_'}</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !isCapturing) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="what needs doing?"
          disabled={isCapturing}
          className="flex-1 bg-transparent text-text placeholder:text-text-muted focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Smart sorting for active items using isEvent-aware logic:
 *
 * Priority order:
 * 1. Overdue actions (deadline passed) - MUST do
 * 2. Actions due today - urgent
 * 3. Stale actions (no date) - actionable NOW, sorted by staleness
 * 4. Events TODAY - time-bound reminders
 * 5. Actions due within 3 days - approaching deadlines
 * 6. Events tomorrow - advance notice
 * 7. Actions 4-7 days out
 * 8. Future items (>7 days for actions, >1 day for events)
 *
 * Key insight: Stale actions beat same-day events because actions
 * are immediately actionable, while events are time-bound.
 */
function sortByUrgency(items: TowerItem[]): TowerItem[] {
  const today = new Date();

  // Helper to get days until date
  const daysUntil = (dateStr: string | undefined): number | null => {
    if (!dateStr) return null;
    const target = new Date(dateStr);
    const diff = target.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  // Helper to get staleness (days since last touched)
  const staleness = (item: TowerItem): number => {
    const touched = new Date(item.lastTouched);
    const diff = today.getTime() - touched.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  // Assign priority bucket to each item
  const getPriority = (item: TowerItem): number => {
    const days = daysUntil(item.expectsBy);
    const isEvent = item.isEvent ?? false;

    // Actions (isEvent: false)
    if (!isEvent) {
      if (days !== null) {
        if (days < 0) return 0;  // Overdue - highest priority
        if (days === 0) return 1;  // Due today
        if (days <= 3) return 4;  // Due soon
        if (days <= 7) return 6;  // This week
        return 7;  // Far future
      }
      return 2;  // No date - stale actions are actionable NOW
    }

    // Events (isEvent: true)
    if (days !== null) {
      if (days <= 0) return 3;  // Event today (or past)
      if (days === 1) return 5;  // Event tomorrow
      return 7;  // Future events hidden
    }
    return 2;  // Event with no date (rare, treat as stale)
  };

  return [...items].sort((a, b) => {
    const priorityA = getPriority(a);
    const priorityB = getPriority(b);

    // Different priority buckets - sort by bucket
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Same bucket - secondary sorting
    const daysA = daysUntil(a.expectsBy);
    const daysB = daysUntil(b.expectsBy);

    // For items with dates, sort by date
    if (daysA !== null && daysB !== null) {
      return daysA - daysB;
    }

    // For no-date items (stale bucket), sort by staleness (older first)
    if (daysA === null && daysB === null) {
      return staleness(b) - staleness(a);  // More stale = higher priority
    }

    // Items with dates before items without
    return daysA !== null ? -1 : 1;
  });
}

function getAge(timestamp: string): string {
  const now = new Date();
  const created = new Date(timestamp);
  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function formatDate(dateStr: string, isEvent?: boolean): string {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];

  if (dateStr === todayStr) return 'today';
  if (dateStr === tomorrowStr) return 'tomorrow';

  const date = new Date(dateStr);
  const day = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
  const dayNum = date.getDate();

  // For events, show more context
  if (isEvent) {
    return `${day} ${dayNum} ${month}`;
  }

  return day;
}
