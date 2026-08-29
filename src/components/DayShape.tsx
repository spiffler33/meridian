/**
 * The day's real shape, above what you decide to do with it.
 *
 * An instrument, not a calendar: no grid, no lanes, no coloured blocks. One
 * line per commitment, in the order they arrive, with the clock times in mono
 * so the gaps between them are visible as gaps. What it is for is the space
 * *between* the rows — that is where the day's work has to fit.
 *
 * One accent, once: the event you are in or about to be in. Everything else
 * is ink, muted, or faint. The per-calendar dot is the only other colour, and
 * it is 7px because that is what the library's unread dot is.
 *
 * It renders what the mirror says and nothing more. Titles are not redacted
 * here — that is done at source, by the mirror's own `PRIVATE_CALS` switch.
 */

import { dayShape, eventsForDay, isMirrorStale, timeLabel } from '../lib/calendar';
import { AllDayChip, Dot } from './calendarUi';
import type { CalendarMirror } from '../lib/calendar';

export function DayShape({
  mirror,
  date,
  timeZone,
  now,
}: {
  mirror: CalendarMirror | null;
  date: string;
  timeZone: string;
  now: number;
}) {
  const rows = dayShape(eventsForDay(mirror, date, timeZone), now);
  const allDay = rows.filter(row => row.event.allDay);
  const timed = rows.filter(row => !row.event.allDay);
  const stale = isMirrorStale(mirror?.generatedAt ?? null, now);

  return (
    <section>
      <h2 className="text-xs uppercase tracking-label text-text-muted mb-3">Day shape</h2>

      {allDay.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {allDay.map(row => (
            <AllDayChip key={row.event.id} event={row.event} />
          ))}
        </div>
      )}

      {timed.length > 0 && (
        <div className="space-y-2">
          {timed.map(row => (
            <div key={row.event.id} className="flex items-baseline gap-2.5">
              <span className="-translate-y-0.5">
                <Dot calendar={row.event.calendar} lit={row.next} />
              </span>
              <span
                className={`flex-shrink-0 font-mono text-xs tabular-nums ${
                  row.past ? 'text-text-muted' : 'text-text-secondary'
                }`}
              >
                {timeLabel(row.event.start, timeZone)}–{timeLabel(row.event.end, timeZone)}
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate font-mono text-xs ${
                    row.past ? 'text-text-muted' : row.next ? 'text-text' : 'text-text-secondary'
                  }`}
                >
                  {row.event.title}
                </span>
                {row.event.location && (
                  <span className="block truncate font-mono text-2xs text-text-muted">
                    {row.event.location}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 && (
        // A statement, not an alarm. An empty day is a fact about the day.
        <div className="font-mono text-xs text-text-muted">no events mirrored today</div>
      )}

      {stale && mirror && (
        <div className="mt-3 font-mono text-2xs text-accent">
          mirror stale since {timeLabel(new Date(mirror.generatedAt).toISOString(), timeZone)}
        </div>
      )}
    </section>
  );
}
