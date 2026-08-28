/**
 * Pulse — the capture page.
 *
 * Its own place on the rail, because on a talkative day the stream fills a
 * screen and pushed everything Tower is for below the fold. Gate 1's verdict,
 * on the first morning of real use.
 *
 * The shape is a conversation: the day reads downward, oldest at the top, the
 * box docked at the foot of the screen, and the newest line landing directly
 * above it. Arriving puts the cursor in the box — the tab IS the gesture, so
 * there is nothing to tap before typing. Escape gives the keyboard back to the
 * rest of the app, which is otherwise unreachable while a field has focus.
 *
 * Today only. Yesterday belongs to the year and to the ledger phase 3 builds.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Dock } from '../components/Dock';
import { deviceTimeZone, timeLabel } from '../lib/calendar';
import { usePulses } from '../hooks/usePulses';
import { getToday } from '../utils/dates';
import type { PulseRow } from '../lib/entities';

export function PulseView() {
  const today = getToday();
  const timeZone = deviceTimeZone();
  const pulses = usePulses(today, timeZone);

  // Pinned to the bottom: arriving shows the newest, and a captured line
  // scrolls itself into view rather than landing under the fold. Before paint,
  // so the jump is never seen.
  useLayoutEffect(() => {
    window.scrollTo(0, document.body.scrollHeight);
  }, [pulses.today]);

  return (
    <>
      <PulseStream pulses={pulses.today} timeZone={timeZone} onDelete={pulses.remove} />
      <Dock>
        <PulseCapture onCapture={pulses.capture} />
      </Dock>
    </>
  );
}

/**
 * The day's stream.
 *
 * A ledger, not a feed: mono clock, the line as it was said, and nothing else
 * on it. Nothing is shown when nothing has been captured — the box's own
 * placeholder is the only instruction an empty day needs.
 *
 * There is no edit. Delete is two taps behind a kebab, which is what keeps a
 * pocket from erasing a line, and which works with a finger — a hover-only
 * control is invisible on the device this app mostly runs on.
 */
function PulseStream({
  pulses,
  timeZone,
  onDelete,
}: {
  pulses: readonly PulseRow[];
  timeZone: string;
  onDelete: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (pulses.length === 0) return null;

  return (
    <ul className="space-y-2">
      {pulses.map((pulse) => (
        <li key={pulse.id} className="flex items-baseline gap-3">
          <time className="font-mono text-xs tabular-nums text-text-muted">
            {timeLabel(pulse.at, timeZone)}
          </time>
          <span className="flex-1 font-read text-[14.5px] leading-[1.6] text-text">
            {pulse.text}
          </span>
          {openId === pulse.id && (
            <button
              onClick={() => {
                setOpenId(null);
                onDelete(pulse.id);
              }}
              className="text-xs text-error hover:underline"
            >
              delete
            </button>
          )}
          <button
            onClick={() => setOpenId(openId === pulse.id ? null : pulse.id)}
            aria-label={`actions for the pulse at ${timeLabel(pulse.at, timeZone)}`}
            aria-expanded={openId === pulse.id}
            className="font-mono text-xs text-text-muted transition-colors hover:text-text"
          >
            ···
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The capture box, at the foot of the page.
 *
 * One field and nothing else — no pickers, no button, no confirmation. Enter
 * saves and the field clears; an empty Enter does nothing. The text goes back
 * into the field if the write failed, because the alternative is a sentence
 * the owner said and the app quietly lost.
 *
 * `focus:outline-none` on the input is paid for by the rule above it, which
 * takes the accent while the box has focus: the affordance moves, it does not
 * disappear.
 */
function PulseCapture({ onCapture }: { onCapture: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    const text = draft;
    if (text.trim().length === 0) return;
    // Cleared first: the box is empty the instant the owner hits Enter, and
    // the next thought can start being typed into it while this one is
    // reaching IndexedDB.
    setDraft('');
    const saved = await onCapture(text);
    if (!saved) setDraft((previous) => (previous.length === 0 ? text : previous));
  }, [draft, onCapture]);

  return (
    <div className="flex items-center border-t border-border py-3 transition-colors focus-within:border-accent">
      <input
        ref={box}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          // The view keys are dead while a field has focus, which is the whole
          // app while this page is open. Escape is the way back out.
          if (e.key === 'Escape') box.current?.blur();
        }}
        placeholder="what's happening…"
        aria-label="capture a pulse"
        className="w-full bg-transparent font-read text-[14.5px] text-text placeholder:text-text-muted focus:outline-none"
      />
    </div>
  );
}
