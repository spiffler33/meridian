/**
 * Tower View - Attention Steering Interface
 *
 * Surfaces what needs attention now, hides the rest accountably.
 * Core loop: Open -> See 1-3 items -> Act or Hold -> Trust the system
 *
 * One grammar for the whole page: an uppercase mono label, its content, and a
 * hairline rule where two sections genuinely need separating. No card inside a
 * section and no dashed frame around an absence — a box around a box says the
 * same thing twice, and the day's one hero is marked by the accent caret in
 * front of it rather than by a border around it.
 */

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../store/AppContext';
import { Section } from '../components/Section';
import { TwoMinuteTimer } from '../components/TwoMinuteTimer';
import { DayShape } from '../components/DayShape';
import { Dock } from '../components/Dock';
import { deviceTimeZone } from '../lib/calendar';
import { getToday } from '../utils/dates';
import { dueLabel, getAge, sortByUrgency } from '../utils/tower';
import type { CalendarMirror } from '../lib/calendar';
import type { TowerItem } from '../types';

export default function TowerView({ mirror }: { mirror: CalendarMirror | null }) {
  const {
    state,
    addTowerItem,
    completeTowerItemById,
    updateTowerItemById,
    deleteTowerItemById,
  } = useApp();

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
   * Add immediately — zero-friction capture, and nothing else.
   *
   * There is no parse, no model, and since phase 4 no pulse either: the line
   * IS the task, written straight to the tower store. Tower is a manual,
   * intentional space (fence 9), so a submission here is a commitment the
   * owner made, not an utterance for a coder to read.
   *
   * The text comes back if the write failed — `addTowerItem` rethrows for
   * exactly this, so the sentence is never lost to a swallowed error.
   */
  const handleCapture = useCallback(async () => {
    const text = captureText.trim();
    if (!text || isCapturing) return;

    setIsCapturing(true);
    setCaptureText('');

    try {
      await addTowerItem({ text });
    } catch {
      setCaptureText(text);
    }
    setIsCapturing(false);
  }, [captureText, isCapturing, addTowerItem]);

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
        `Date.now()` in render is impure and the rule is right about it. The
        error is pre-existing — the previous revision of this file lints clean
        with this identical line — and it surfaced only because the compiler
        bails out of a component containing `try`, which this file's capture
        handler no longer needs. Suppressed rather than re-hidden behind one.

        Not deferred: there is no lint-clean way to hand DayShape a fresh
        reading per render. It takes `now` as a prop from one production caller
        and ten test call sites, and "DayShape owning its own clock" is a
        ticker in different words — which the owner has explicitly declined.
        So this waits on an owner DECISION between the two costs: a timer that
        re-renders this page on an interval, or `now` sampled once at mount,
        which freezes both what DayShape lights as next and whether the mirror
        reads stale on a page left open all day. Neither is this stage's to
        choose, and the suppression stands until one is chosen.
      */}
      {/* eslint-disable-next-line react-hooks/purity */}
      <DayShape mirror={mirror} date={today} timeZone={timeZone} now={Date.now()} />

      {/* NOW Section - Hero Item */}
      <Section label="Now">
        {nowItem ? (
          <NowItem
            item={nowItem}
            onComplete={() => completeTowerItemById(nowItem.id)}
            onHold={(waitingOn) => handleHold(nowItem.id, waitingOn)}
            onSomeday={() => handleSomeday(nowItem.id)}
            onStartTimer={() => handleStartTimer(nowItem.id)}
            isTimerRunning={timerItemId === nowItem.id}
            onEdit={(text) => handleEdit(nowItem.id, text)}
          />
        ) : (
          // A sentence, in the app's own register. An absence is a fact about
          // the day, not something to frame and centre.
          <p className="text-sm text-text-muted">nothing needs attention right now</p>
        )}
      </Section>

      {/* Queue - Next items */}
      {queueItems.length > 0 && (
        <section>
          <QueueList
            items={queueItems}
            onComplete={completeTowerItemById}
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
                onComplete={completeTowerItemById}
              />
            </div>
          )}
        </section>
      )}

      {/* Follow Up (blocked items) */}
      {waitingItems.length > 0 && (
        <Drawer label="Follow Up" count={waitingItems.length}>
          {waitingItems.map((item) => (
            <li key={item.id} className="group text-sm text-text-muted">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-read text-text-secondary">{item.text}</span>
                  {item.waitingOn && (
                    <span className="text-xs">· {item.waitingOn}</span>
                  )}
                  {item.expectsBy && (
                    <span className="text-xs">· {dueLabel(item.expectsBy)}</span>
                  )}
                </div>
                <button
                  onClick={() => handleReactivate(item.id)}
                  className="text-xs opacity-0 group-hover:opacity-100 text-accent hover:underline transition-opacity"
                >
                  reactivate
                </button>
              </div>
            </li>
          ))}
        </Drawer>
      )}

      {/* Someday */}
      <Drawer label="Someday" count={somedayItems.length}>
        {somedayItems.map((item) => (
          <li key={item.id} className="group text-sm text-text-muted">
            <div className="flex items-center justify-between">
              <span className="font-read">{item.text}</span>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleReactivate(item.id)}
                  className="text-xs text-accent hover:underline"
                >
                  activate
                </button>
                <button
                  onClick={() => deleteTowerItemById(item.id)}
                  className="text-xs text-error hover:underline"
                >
                  delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </Drawer>

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

interface NowItemProps {
  item: TowerItem;
  onComplete: () => void;
  onHold: (waitingOn?: string) => void;
  onSomeday: () => void;
  onStartTimer: () => void;
  isTimerRunning: boolean;
}

/**
 * The one thing. Marked by the caret and by the reading face, not by a frame:
 * the section it sits in is already labelled, and a bordered card inside a
 * labelled section is the second frame saying the first frame's sentence.
 */
function NowItem({ item, onComplete, onHold, onSomeday, onStartTimer, isTimerRunning, onEdit }: NowItemProps & { onEdit: (text: string) => void }) {
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
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-accent font-bold">&gt;</span>
        <div className="flex-1">
          {isEditing ? (
            // Same face and size as the line it replaces, so nothing jumps
            // when the text becomes editable.
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
              className="w-full bg-bg border border-border rounded px-2 py-1 font-read text-base text-text focus:outline-none focus:border-accent"
              autoFocus
            />
          ) : (
            // The owner's own sentence — the reading face, at reading size.
            <p
              className="font-read text-base text-text cursor-pointer hover:text-accent transition-colors"
              onClick={() => setIsEditing(true)}
              title="Click to edit"
            >
              {item.text}
            </p>
          )}
          {/* Its metadata is the instrument's, so it stays mono. */}
          <p className="text-xs text-text-muted mt-1">
            {item.expectsBy && `${dueLabel(item.expectsBy, item.isEvent)} · `}
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

    </div>
  );
}

interface QueueListProps {
  items: TowerItem[];
  onComplete: (id: string) => void;
}

function QueueList({ items, onComplete }: QueueListProps) {
  return (
    <ul className="space-y-2 border-l border-border pl-4 ml-2">
      {items.map((item) => (
        <li key={item.id} className="text-text-secondary group">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onComplete(item.id)}
              className="w-4 h-4 border border-border rounded hover:border-accent transition-colors flex items-center justify-center"
              title="Mark done"
            >
              <span className="opacity-0 group-hover:opacity-100 text-xs text-accent">
                +
              </span>
            </button>
            <span className="font-read text-sm">{item.text}</span>
            {item.expectsBy && (
              <span className="text-xs text-text-muted">· {dueLabel(item.expectsBy, item.isEvent)}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A closed list with a count on it.
 *
 * Follow Up and Someday are the same object — a label, how many sit behind it,
 * and the rows once it is open. They were two copies of that, which is two
 * places for the disclosure to drift apart. Only the rows differ, so only the
 * rows are passed in.
 *
 * An empty drawer does not draw. A zero is not a fact about the day — it is
 * the absence of one, and `someday (0)` under `follow up (0)` is two rows of
 * furniture on a page whose whole job is to be nearly empty. Nothing is lost:
 * the way into either list is the button on the item being parked, not the
 * drawer it lands in, and the drawer appears the moment it holds something.
 */
function Drawer({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  if (count === 0) return null;

  return (
    <Section
      label={
        <button
          onClick={() => setExpanded(!expanded)}
          // `uppercase` is not inherited: preflight resets `text-transform` on
          // every button, so the section's own casing stops at this element.
          className="uppercase hover:text-text-secondary transition-colors flex items-center gap-2"
        >
          <span>{expanded ? '[-]' : '[+]'}</span>
          {label} ({count})
        </button>
      }
    >
      {expanded && <ul className="space-y-2">{children}</ul>}
    </Section>
  );
}

interface CaptureInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isCapturing?: boolean;
}

/**
 * Where the owner writes, so it is the reading face — and `focus:outline-none`
 * on the field is paid for by the rule above it, which takes the accent while
 * the box has focus. The affordance moves; it does not disappear.
 */
function CaptureInput({ value, onChange, onSubmit, isCapturing }: CaptureInputProps) {
  return (
    <div className="border-t border-border py-3 transition-colors focus-within:border-accent">
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
          className="flex-1 bg-transparent font-read text-base text-text placeholder:text-text-muted focus:outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}
