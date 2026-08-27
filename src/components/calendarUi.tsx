/**
 * The two marks every calendar surface shares.
 *
 * Appendix B: the dot is the only per-calendar colour anywhere in the app.
 * Titles stay ink or muted, because a list of coloured titles is a rainbow
 * and this is an instrument.
 */

import type { CalendarEvent } from '../lib/calendar';

const DOT: Record<string, string> = {
  home: 'bg-sp-green',
  personal: 'bg-sp-ice',
  db: 'bg-sp-amber',
};

const DOT_FALLBACK = 'bg-sp-muted';

/**
 * 7px, which is the library's unread dot — the same geometry, so the two
 * surfaces read as the same instrument rather than as two designs.
 *
 * `lit` is spent once per day, on the event you are in or about to be in. It
 * keeps the calendar's own colour underneath and adds the unread dot's glow:
 * this says "now", not "a different kind of thing".
 */
export function Dot({ calendar, lit }: { calendar: string; lit?: boolean }) {
  return (
    <span
      className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${DOT[calendar] ?? DOT_FALLBACK}`}
      style={lit ? { boxShadow: '0 0 8px currentColor', color: 'var(--sp-amber)' } : undefined}
    />
  );
}

/** An all-day event: no clock, so no time — the absence is the signal. */
export function AllDayChip({ event, faded }: { event: CalendarEvent; faded?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-[9px] border border-sp-hair px-[7px] pb-[2px] pt-px font-mono text-[10.5px] ${
        faded ? 'text-sp-faint' : 'text-sp-muted'
      }`}
    >
      <Dot calendar={event.calendar} />
      <span className="truncate">{event.title}</span>
    </span>
  );
}
