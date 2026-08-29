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

import { Chip } from '../components/Chip';
import { Dock } from '../components/Dock';
import { deviceTimeZone, timeLabel } from '../lib/calendar';
import { useApp } from '../store/AppContext';
import { usePulses } from '../hooks/usePulses';
import type { Pulses } from '../hooks/usePulses';
import { dayNutrition, kcalLabel } from '../lib/ledger';
import type { DayNutrition } from '../lib/ledger';
import { effectChipLabel, effectKey, vocabChipLabel } from '../lib/pulse';
import { getToday } from '../utils/dates';
import type { PulseRow } from '../lib/entities';

export function PulseView() {
  const today = getToday();
  const timeZone = deviceTimeZone();
  const pulses = usePulses(today, timeZone);
  const { profile } = useApp();

  // Pinned to the bottom: arriving shows the newest, and a captured line
  // scrolls itself into view rather than landing under the fold. Before paint,
  // so the jump is never seen.
  useLayoutEffect(() => {
    window.scrollTo(0, document.body.scrollHeight);
  }, [pulses.today]);

  return (
    <>
      <PulseStream pulses={pulses.today} timeZone={timeZone} actions={pulses} />
      <Dock>
        <NutritionLine
          total={dayNutrition(pulses.today, today, timeZone)}
          target={profile?.kcal_target ?? null}
        />
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
  actions,
}: {
  pulses: readonly PulseRow[];
  timeZone: string;
  actions: Pulses;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (pulses.length === 0) return null;

  return (
    <ul className="space-y-2">
      {pulses.map((pulse) => (
        // A grid rather than a row: the chips sit in the text's own column,
        // under the line they belong to, without anything having to know how
        // wide a timestamp is.
        <li key={pulse.id} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-2">
          <span className="flex items-center gap-1.5">
            {/*
              Hollow = uncoded, filled = coded. No spinner, no color beyond
              this: the coder runs invisibly, and uncoded is a calm, valid
              state rather than a loading one.
            */}
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full border border-text-muted ${
                pulse.signal === undefined ? 'bg-transparent' : 'bg-text-muted'
              }`}
            />
            <time className="font-mono text-xs tabular-nums text-text-muted">
              {timeLabel(pulse.at, timeZone)}
            </time>
          </span>
          <span className="font-read text-[14.5px] leading-[1.6] text-text">
            {pulse.text}
          </span>
          <span className="flex items-baseline gap-3">
            {openId === pulse.id && (
              <button
                onClick={() => {
                  setOpenId(null);
                  actions.remove(pulse.id);
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
          </span>
          <PulseChips pulse={pulse} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The proposals under one line.
 *
 * Nothing renders when a pulse has none, which is most of them — a coding
 * usually classifies and proposes nothing at all, and an empty row under every
 * line would turn the stream into a form. Effects first, in the order the
 * coder gave them, then the vocabulary proposal, which is the only one that
 * changes what the coder reads next.
 */
function PulseChips({ pulse, actions }: { pulse: PulseRow; actions: Pulses }) {
  const effects = pulse.effects ?? [];
  const proposal = pulse.vocabProposal ?? null;
  if (effects.length === 0 && proposal === null) return null;

  return (
    <div className="col-start-2 col-span-2 flex flex-wrap items-center gap-2">
      {effects.map((effect) => (
        <Chip
          // The effect itself, never its position — as the React key, and as
          // what the tap carries. An apply removes one and shifts the rest
          // down: React would reuse the node of the chip that was there,
          // swapping the label under a finger already on its way to the
          // button, and a position would name whatever moved into it.
          key={effectKey(effect)}
          label={effectChipLabel(effect)}
          onApply={() => actions.applyEffect(pulse.id, effect)}
          onDismiss={() => actions.dismissEffect(pulse.id, effect)}
        />
      ))}
      {proposal !== null && (
        <Chip
          label={vocabChipLabel(proposal)}
          onApply={() => actions.applyVocab(pulse.id)}
          onDismiss={() => actions.dismissVocab(pulse.id)}
        />
      )}
    </div>
  );
}

/**
 * The day's eating, on one line above the box.
 *
 * An instrument, not a message. It reports four numbers and says nothing
 * about any of them — no color that changes with the total, no word for over
 * or under, no encouragement (fence 6). The target, when the owner has set
 * one, is printed in the same face and weight as everything else: a number
 * beside a number.
 *
 * Nothing renders on a day with no food logged. An empty instrument above the
 * box every morning would turn the capture page into a form with a blank
 * field at the top of it, and a zero is not a fact here — it is the absence
 * of one.
 *
 * The parts after the total are each conditional, and each disappears rather
 * than showing a zero: "0 uncounted" is noise on the ordinary day, and the
 * whole point of the uncounted tally is that it is unusual enough to notice.
 */
function NutritionLine({ total, target }: { total: DayNutrition; target: number | null }) {
  const logged = total.kcal > 0 || total.uncounted > 0 || total.proteinG > 0;
  if (!logged) return null;

  const calories = [`${kcalLabel(total.kcal)} kcal`];
  // Attached to the figure it qualifies, before the breakdown of that figure.
  // Provisional by the plan's own words — the shape of this is Gate 5's to
  // settle, and it is one array entry to move or delete.
  if (target !== null) calories.push(`of ${kcalLabel(target)}`);
  if (total.estimatedKcal > 0) calories.push(`${kcalLabel(total.estimatedKcal)} est`);
  if (total.uncounted > 0) calories.push(`${total.uncounted} uncounted`);

  return (
    <p className="flex flex-wrap items-baseline gap-x-4 pt-3 font-mono text-[11.5px] tabular-nums text-text-muted">
      <span>{calories.join(' · ')}</span>
      {total.proteinG > 0 && <span>{`${kcalLabel(total.proteinG)} g protein`}</span>}
    </p>
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
