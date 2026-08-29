/**
 * Energy: the coded stream, added up.
 *
 * Phase 3 is arithmetic and the drawing of it. Every number on this surface
 * comes out of `lib/ledger`, which is pure and tested; nothing is computed
 * here except a bar's width. That split is deliberate — a chart that does its
 * own sums is a chart whose sums cannot be pinned by a test.
 *
 * It says nothing about what the numbers mean. No trend, no target, no "you
 * spent less on family this week" (fence 6). Two adjacent charts and a
 * histogram, and where a comparison is not clean it is simply not drawn.
 *
 * The week is the one the rest of Year is already on, so the stepper here
 * moves the lens above it too. Two week states on one page would let the same
 * screen show two different weeks and call them both "this week".
 */

import { useCallback, useMemo } from 'react';

import { useAsync } from '../hooks/useAsync';
import { deviceTimeZone } from '../lib/calendar';
import type { CalendarMirror } from '../lib/calendar';
import {
  activityTiming,
  claimedEventIds,
  closeSpans,
  HISTOGRAM_WEEKS,
  kcalLabel,
  ledgerHonesty,
  neededByCalendar,
  pairNeededSpent,
  spentByDomain,
  trailingWindow,
  weekNutrition,
  weekWindow,
} from '../lib/ledger';
import type { ActivityTiming, CalendarHours, DayKcal, DomainHours, WeekNutrition } from '../lib/ledger';
import { getPulses } from '../services/data';
import { Section } from './Section';
import { StepNav } from './StepNav';
import { getWeekNumber } from '../utils/dates';

interface EnergySectionProps {
  mirror: CalendarMirror | null;
  /** Any date in the week being shown — the same one the week lens is on. */
  selectedDate: string;
  weekStartsOn: 0 | 1;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
}

/**
 * Two accents, spent against needed, plus a faint ghost for the hours that did
 * not count. The dot map in `calendarUi` spends the same palette on calendars;
 * here it separates one chart from another rather than one calendar from
 * another, which is why this is its own list and not an import of that one.
 */
const SPENT_TONE = 'bg-accent';
const NEEDED_TONE = 'bg-cite';
const UNCLAIMED_TONE = 'bg-text-muted';

const hours = (value: number) => value.toFixed(1);

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-text-muted uppercase tracking-caps">{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className=" text-xs text-text-muted">{children}</p>;
}

interface BarProps {
  name: string;
  /** The quantity itself. The widest bar in a chart sets that chart's scale. */
  value: number;
  widest: number;
  tone: string;
  /** Drawn behind the bar, in the same track: hours that did not count. */
  ghost?: number;
  note?: string;
}

/**
 * One bar, with its number outside it.
 *
 * Inside the bar the number is unreadable at the short end and invisible at
 * zero, and zero is a value this chart has to be able to show — a domain with
 * no hours this week is a fact, not an absence.
 */
function Bar({ name, value, widest, tone, ghost = 0, note }: BarProps) {
  // `rounded-[3px]` rather than the token `rounded` (6px), here and on every
  // other bar in this file: the track is 12px tall, and a 6px radius on a 12px
  // bar is a pill. Half the height is the largest radius that still reads as a
  // rectangle. Deliberate — not a value the next sweep should round up.
  const scale = (amount: number) => (widest <= 0 ? 0 : Math.min(100, (amount / widest) * 100));
  return (
    <div className="grid grid-cols-[76px_1fr_44px] items-center gap-2.5 py-0.5 sm:grid-cols-[108px_1fr_52px]">
      <span className="truncate text-xs text-text-secondary" title={name}>
        {name}
      </span>
      <span className="relative block h-3 overflow-hidden rounded-[3px] bg-bg-hover">
        {ghost > 0 && (
          <span
            className={`absolute inset-y-0 left-0 rounded-[3px] ${UNCLAIMED_TONE} opacity-40`}
            style={{ width: `${scale(value + ghost)}%` }}
          />
        )}
        <span
          className={`absolute inset-y-0 left-0 rounded-[3px] ${tone}`}
          style={{ width: `${scale(value)}%` }}
        />
      </span>
      <span className="text-right text-xs tabular-nums text-text" title={note}>
        {hours(value)}
      </span>
    </div>
  );
}

/** The widest value in a chart, which is what every bar in it is drawn against. */
function widestOf(values: readonly number[]): number {
  return values.reduce((most, value) => Math.max(most, value), 0);
}

function SpentChart({ bars }: { bars: DomainHours[] }) {
  const widest = widestOf(bars.map(bar => bar.hours));
  return (
    <div>
      {bars.map(bar => (
        <Bar
          key={bar.domain ?? ' unassigned'}
          name={bar.domain ?? 'unassigned'}
          value={bar.hours}
          widest={widest}
          tone={SPENT_TONE}
          note={bar.derivedHours > 0 ? `${hours(bar.derivedHours)} h inferred, not stated` : undefined}
        />
      ))}
    </div>
  );
}

function NeededChart({ bars }: { bars: CalendarHours[] }) {
  const widest = widestOf(bars.map(bar => bar.hours + bar.unclaimed));
  return (
    <div>
      {bars.map(bar => (
        <Bar
          key={bar.calendar}
          name={bar.calendar}
          value={bar.hours}
          ghost={bar.unclaimed}
          widest={widest}
          tone={NEEDED_TONE}
          note={bar.unclaimed > 0 ? `${hours(bar.unclaimed)} h unclaimed` : undefined}
        />
      ))}
    </div>
  );
}

/**
 * The one comparison that is honest: a calendar and a domain that are the
 * same word. Everything else sits in its own chart above and is never
 * subtracted from anything.
 */
function PairedChart({ paired }: { paired: Array<{ name: string; needed: number; spent: number }> }) {
  const widest = widestOf(paired.flatMap(pair => [pair.needed, pair.spent]));
  return (
    <div className="space-y-1">
      {paired.map(pair => (
        <div key={pair.name}>
          <Bar name={`${pair.name} needed`} value={pair.needed} widest={widest} tone={NEEDED_TONE} />
          <Bar name={`${pair.name} spent`} value={pair.spent} widest={widest} tone={SPENT_TONE} />
        </div>
      ))}
    </div>
  );
}

/** The hours labelled under the strip. Four is enough to read it by; twenty-four is a wall. */
const HOUR_TICKS = [0, 6, 12, 18];

/**
 * One activity's day, as twenty-four cells.
 *
 * A heat strip rather than bars: the question is "when", and at this size a bar
 * chart of twenty-four columns is a picket fence. The ramp is the year
 * heatmap's own, so the two instruments on this page read as one language.
 */
function TimingRow({ row }: { row: ActivityTiming }) {
  const busiest = widestOf(row.hours);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs text-text-secondary">{row.activity}</span>
        <span className=" text-xs tabular-nums text-text-muted">{row.total}</span>
      </div>
      <div className="flex gap-px" role="img" aria-label={`${row.activity}: ${row.total} logged`}>
        {row.hours.map((count, hour) => {
          const level = count === 0 ? 0 : Math.min(5, Math.ceil((count / busiest) * 5));
          return (
            <span
              key={hour}
              className={`h-3 flex-1 rounded-[1px] heat-${level}`}
              title={`${String(hour).padStart(2, '0')}:00 - ${count}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One day's calories, as a two-tone bar.
 *
 * Its own component rather than a use of `Bar` above: that one is shaped for
 * hours — it prints `toFixed(1)` and draws its second quantity as a ghost
 * BEHIND the bar, for a total the owner did not log. Here the second quantity
 * is a share OF the bar, in the same accent at lower opacity, because an
 * estimated calorie is still a counted calorie and the eye should read one
 * bar with a soft half rather than two competing ones.
 *
 * Estimated is drawn first and full-width-of-its-share, with the stated part
 * laid over the left of it: the boundary between them lands where stated ends,
 * which is the only place it means anything.
 *
 * A day the owner corrected draws single-tone, with no estimate marker at all:
 * the number came from them, so there is no share of it that rests on a guess
 * and nothing for the two tones to separate.
 *
 * The value sits outside the bar, as everywhere on this page — inside, it is
 * unreadable at the short end and invisible on a day with nothing logged, and
 * an empty day is exactly the day the chart has to be able to show.
 */
function KcalBar({ day, widest }: { day: DayKcal; widest: number }) {
  const scale = (amount: number) => (widest <= 0 ? 0 : Math.min(100, (amount / widest) * 100));
  const stated = day.corrected ? day.kcal : day.kcal - day.estimatedKcal;
  const showsEstimate = !day.corrected && day.estimatedKcal > 0;
  return (
    <div className="grid grid-cols-[76px_1fr_44px] items-center gap-2.5 py-0.5 sm:grid-cols-[108px_1fr_52px]">
      <span className="truncate text-xs text-text-secondary">{weekdayLabel(day.date)}</span>
      <span className="relative block h-3 overflow-hidden rounded-[3px] bg-bg-hover">
        {showsEstimate && (
          <span
            className={`absolute inset-y-0 left-0 rounded-[3px] ${SPENT_TONE} opacity-40`}
            style={{ width: `${scale(day.kcal)}%` }}
          />
        )}
        <span
          className={`absolute inset-y-0 left-0 rounded-[3px] ${SPENT_TONE}`}
          style={{ width: `${scale(stated)}%` }}
        />
      </span>
      <span
        className="text-right text-xs tabular-nums text-text"
        title={showsEstimate ? `${kcalLabel(day.estimatedKcal)} kcal estimated` : undefined}
      >
        {day.kcal > 0 ? kcalLabel(day.kcal) : ''}
      </span>
    </div>
  );
}

/**
 * Three letters of the weekday, from the date string itself.
 *
 * `YYYY-MM-DD` is a machine-defined format and splitting one is explicitly
 * allowed (fence 1); the parts are handed to `Date.UTC` and read back in UTC,
 * so the label can never slide a day the way `new Date('2026-08-29')` read in
 * a local zone west of Greenwich would.
 */
function weekdayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const at = Date.UTC(year, month - 1, day);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(at).toLowerCase();
}

function KcalChart({ nutrition }: { nutrition: WeekNutrition }) {
  const widest = widestOf(nutrition.days.map(day => day.kcal));
  return (
    <div>
      {nutrition.days.map(day => (
        <KcalBar key={day.date} day={day} widest={widest} />
      ))}
      {nutrition.uncounted > 0 && (
        <p className="pt-1 text-xs text-text-muted">
          {nutrition.uncounted} {nutrition.uncounted === 1 ? 'item' : 'items'} eaten, not counted
        </p>
      )}
    </div>
  );
}

export function EnergySection({
  mirror,
  selectedDate,
  weekStartsOn,
  onPreviousWeek,
  onNextWeek,
}: EnergySectionProps) {
  // Read once on mount. Year is a perspective view rather than a capture
  // surface, so nothing written while it is open needs to appear under the
  // owner's hands; leaving the pulse read out of the render path keeps it
  // that way.
  const load = useCallback(async () => {
    return { pulses: await getPulses() };
  }, []);
  const data = useAsync(load);

  const timeZone = deviceTimeZone();
  const ledger = useMemo(() => {
    if (data.value === null) return null;
    const { pulses } = data.value;
    const window = weekWindow(selectedDate, timeZone, weekStartsOn);
    // Every pulse, not the week's: a block is closed by the next one, which
    // can be on the far side of the week's edge.
    const spans = closeSpans(pulses, timeZone);
    const spent = spentByDomain(spans, window);
    const needed = neededByCalendar(mirror, window, timeZone, claimedEventIds(pulses));
    return {
      spent,
      needed,
      pairs: pairNeededSpent(needed, spent),
      honesty: ledgerHonesty(pulses, window),
      // A wider window than everything above it, and deliberately so: a single
      // week cannot say when something usually happens. The stepper still moves
      // it — this is the twelve weeks ENDING with the week on screen.
      timing: activityTiming(pulses, trailingWindow(window, HISTOGRAM_WEEKS, timeZone), timeZone),
      // By local day rather than by the window's instants: a bar under a
      // weekday's name has to hold exactly what that weekday held.
      nutrition: weekNutrition(pulses, selectedDate, timeZone, weekStartsOn),
    };
  }, [data.value, mirror, selectedDate, timeZone, weekStartsOn]);

  // Which of the four sub-sections have anything to draw. One that has nothing
  // does not render at all: four separate ways of saying the week is empty is
  // not four facts, it is one, and it is said once, below, in one line.
  const spentDrawn = ledger !== null && ledger.spent.length > 0;
  const neededDrawn = ledger !== null && ledger.needed.length > 0;
  // "Nothing was logged" and "nothing that was logged could be counted" are
  // different weeks, and only the first is empty. A week of unsizeable meals
  // still draws — reporting it as an empty week would be the chart telling the
  // owner they did not eat.
  const nutritionDrawn =
    ledger !== null &&
    (ledger.nutrition.days.some(day => day.kcal > 0) || ledger.nutrition.uncounted > 0);
  const timingDrawn = ledger !== null && ledger.timing.rows.length > 0;
  const nothingDrawn = !spentDrawn && !neededDrawn && !nutritionDrawn && !timingDrawn;

  return (
    <Section
      label="energy"
      aside={
        <StepNav onPrev={onPreviousWeek} onNext={onNextWeek} label="week">
          <span className="text-xs tabular-nums text-text-secondary">
            week {getWeekNumber(selectedDate)}
          </span>
        </StepNav>
      }
    >
      {data.pending && <Empty>reading the stream</Empty>}
      {data.error !== null && <Empty>the stream could not be read</Empty>}

      {ledger !== null && (
        <div className="space-y-5">
          {ledger.honesty.uncoded > 0 && (
            <p className=" text-xs text-text-muted">
              {`${ledger.honesty.uncoded} uncoded ${
                ledger.honesty.uncoded === 1 ? 'pulse' : 'pulses'
              } excluded`}
            </p>
          )}

          {nothingDrawn && <Empty>nothing coded this week</Empty>}

          {(spentDrawn || neededDrawn) && (
            <div className="grid gap-5 sm:grid-cols-2">
              {spentDrawn && (
                <div className="space-y-2">
                  <Label>spent by domain</Label>
                  <SpentChart bars={ledger.spent} />
                </div>
              )}
              {neededDrawn && (
                <div className="space-y-2">
                  <Label>needed by calendar</Label>
                  <NeededChart bars={ledger.needed} />
                </div>
              )}
            </div>
          )}

          {ledger.pairs.paired.length > 0 && (
            <div className="space-y-2">
              <Label>needed vs spent</Label>
              <PairedChart paired={ledger.pairs.paired} />
            </div>
          )}

          {nutritionDrawn && (
            <div className="space-y-2">
              <Label>calories by day</Label>
              <KcalChart nutrition={ledger.nutrition} />
            </div>
          )}

          {timingDrawn && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <Label>activity timing</Label>
                <span className=" text-xs text-text-muted">
                  {HISTOGRAM_WEEKS} weeks, local hour
                </span>
              </div>
              <div className="space-y-3">
                {ledger.timing.rows.map(row => (
                  <TimingRow key={row.activity} row={row} />
                ))}
                <div className="flex justify-between text-2xs text-text-muted tabular-nums">
                  {HOUR_TICKS.map(hour => (
                    <span key={hour}>{String(hour).padStart(2, '0')}</span>
                  ))}
                  <span>23</span>
                </div>
                {ledger.timing.hidden > 0 && (
                  <p className=" text-xs text-text-muted">
                    {ledger.timing.hidden} quieter {ledger.timing.hidden === 1 ? 'activity' : 'activities'} not shown
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
