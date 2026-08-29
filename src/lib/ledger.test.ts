/**
 * The ledger's arithmetic, pinned where it can silently lie.
 *
 * Every number Phase 3 shows is a sum over spans the coder produced, so the
 * failures worth pinning are the ones that still render a plausible chart:
 * an open block that swallows the night because nothing capped it, a week
 * whose Sunday hours leaked into Monday's bar, a home calendar billing the
 * owner for the household's dentist, and an hour bucketed by UTC so every
 * evening habit west of Greenwich plots at dawn.
 *
 * Pure until the last block — no IndexedDB, no fetch. Two zones on either side
 * of UTC are used deliberately: a bug that reads a local day off `slice(0, 10)`
 * passes in Europe and fails in both of them.
 *
 * The final block is the exception, and says why in its own comment: the ghost
 * a deleted-then-enriched pulse leaves is a row nothing constructs on purpose,
 * so it can only be reached through the real capture path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CalendarEvent, CalendarMirror } from './calendar';
import { closeDb, enqueue } from './db';
import { ENTITY, resetSession } from './entities';
import type { PulseRow, PulseSignal } from './entities';
import { fold } from './journal';
import type { JournalEvent } from './journal';
import {
  activityTiming,
  claimedEventIds,
  closeSpans,
  dayNutrition,
  endOfLocalDayMs,
  kcalLabel,
  ledgerHonesty,
  localHour,
  neededByCalendar,
  OPEN_BLOCK_CAP_MS,
  pairNeededSpent,
  spentByDomain,
  startOfLocalDayMs,
  TIMING_ROWS,
  trailingWindow,
  weekNutrition,
  weekWindow,
} from './ledger';
import { CODER_REV } from '../services/coder';
import type { Coding } from '../services/coder';
import { createPulse, deletePulse, enrichPulse, getPulses } from '../services/data';

const SGT = 'Asia/Singapore';
const LA = 'America/Los_Angeles';
const HOUR = 60 * 60 * 1000;

/** A coded pulse. Only what a test asserts on is ever passed. */
function coded(
  id: string,
  signal: PulseSignal,
  start: string,
  extra: Partial<PulseRow> = {}
): PulseRow {
  return {
    id,
    text: id,
    at: start,
    signal,
    domain: null,
    activity: null,
    people: [],
    span: { start, end: null, approx: false },
    links: { eventId: null },
    ...extra,
  };
}

function timed(id: string, calendar: string, start: string, end: string): CalendarEvent {
  return { id, calendar, title: id, start, end, allDay: false, location: null };
}

function allDay(id: string, calendar: string, start: string, end: string): CalendarEvent {
  return { id, calendar, title: id, start, end, allDay: true, location: null };
}

function mirrorOf(events: CalendarEvent[]): CalendarMirror {
  return { generatedAt: 0, window: { start: '', end: '' }, calendars: [], events };
}

const hoursOf = (spans: ReturnType<typeof closeSpans>) =>
  spans.map(span => (span.endMs - span.startMs) / HOUR);

describe('local time', () => {
  it('opens a local day at the zone\'s midnight, not UTC\'s', () => {
    // SGT is UTC+8, so Monday opens at 16:00 Sunday UTC.
    expect(new Date(startOfLocalDayMs('2026-08-24', SGT)).toISOString()).toBe(
      '2026-08-23T16:00:00.000Z'
    );
    expect(new Date(startOfLocalDayMs('2026-08-24', LA)).toISOString()).toBe(
      '2026-08-24T07:00:00.000Z'
    );
  });

  it('closes a local day at its own last millisecond across a spring-forward', () => {
    // 2026-03-08 is 23 hours long in Los Angeles: it opens at 08:00Z (PST)
    // and the next day opens at 07:00Z (PDT). A fixed 24h would overshoot by
    // an hour and hand every block on that day a free hour of the next.
    const during = Date.parse('2026-03-08T18:00:00.000Z');
    expect(new Date(endOfLocalDayMs(during, LA)).toISOString()).toBe('2026-03-09T06:59:59.999Z');
  });

  it('buckets an hour by the zone, not by UTC', () => {
    const instant = Date.parse('2026-08-24T13:30:00.000Z');
    expect(localHour(instant, SGT)).toBe(21);
    expect(localHour(instant, LA)).toBe(6);
  });

  it('reads midnight as hour 0 rather than 24', () => {
    expect(localHour(Date.parse('2026-08-23T16:10:00.000Z'), SGT)).toBe(0);
  });

  it('takes a week as Monday through Sunday in the zone', () => {
    const week = weekWindow('2026-08-26', SGT);
    expect(new Date(week.startMs).toISOString()).toBe('2026-08-23T16:00:00.000Z');
    expect(new Date(week.endMs).toISOString()).toBe('2026-08-30T15:59:59.999Z');
  });

  it('walks a trailing window back whole weeks and keeps the end', () => {
    const week = weekWindow('2026-08-26', SGT);
    const trailing = trailingWindow(week, 12, SGT);
    expect(new Date(trailing.startMs).toISOString()).toBe('2026-06-07T16:00:00.000Z');
    expect(trailing.endMs).toBe(week.endMs);
  });
});

/**
 * The activity histogram — phase 3's habit-timing strip, rebuilt after phase 4
 * took habits away from the coder. The label the coder wrote is the whole
 * input: no habit, no alias map, no vocabulary read.
 */
describe('activity timing', () => {
  const window = trailingWindow(weekWindow('2026-08-26', SGT), 12, SGT);

  const atActivity = (id: string, activity: string, start: string, signal: PulseSignal = 'block') =>
    coded(id, signal, start, { activity });

  it('buckets by the local hour of the span start, in the given zone', () => {
    // 23:30 UTC is 07:30 the next morning in Singapore and 16:30 the same
    // afternoon in Los Angeles: one instant, two answers, both correct.
    const pulses = [atActivity('a', 'gym', '2026-08-24T23:30:00.000Z')];

    const sgt = activityTiming(pulses, window, SGT);
    expect(sgt.rows[0].hours[7]).toBe(1);
    expect(sgt.rows[0].total).toBe(1);

    const la = activityTiming(pulses, trailingWindow(weekWindow('2026-08-26', LA), 12, LA), LA);
    expect(la.rows[0].hours[16]).toBe(1);
  });

  it('counts the span start, not when the line was typed', () => {
    // Said at noon about the morning — the coder back-dated the span, and the
    // strip must believe the span, or every back-dated block lands at lunch.
    const rows = activityTiming(
      [coded('a', 'block', '2026-08-24T04:00:00.000Z', {
        activity: 'gym',
        at: '2026-08-24T04:00:00.000Z',
        span: { start: '2026-08-23T23:00:00.000Z', end: null, approx: true },
      })],
      window,
      SGT
    );
    expect(rows.rows[0].hours[7]).toBe(1); // 23:00 UTC = 07:00 SGT
  });

  it('counts only the signals the bars above it are drawn from', () => {
    const rows = activityTiming(
      [
        atActivity('b', 'gym', '2026-08-24T01:00:00.000Z', 'block'),
        atActivity('e', 'gym', '2026-08-24T02:00:00.000Z', 'event'),
        // A line ABOUT the gym is not the gym happening.
        atActivity('n', 'gym', '2026-08-24T03:00:00.000Z', 'note'),
        atActivity('s', 'gym', '2026-08-24T04:00:00.000Z', 'state'),
        atActivity('p', 'gym', '2026-08-24T05:00:00.000Z', 'plan'),
      ],
      window,
      SGT
    );
    expect(rows.rows[0].total).toBe(2);
  });

  it('ignores an uncoded pulse, one with no activity, and one outside the window', () => {
    const rows = activityTiming(
      [
        { id: 'u', text: 'u', at: '2026-08-24T01:00:00.000Z' },
        atActivity('none', '', '2026-08-24T01:00:00.000Z'),
        coded('bare', 'block', '2026-08-24T01:00:00.000Z'),
        atActivity('old', 'gym', '2026-01-02T01:00:00.000Z'),
      ],
      window,
      SGT
    );
    expect(rows.rows).toEqual([]);
    expect(rows.hidden).toBe(0);
  });

  it('ignores a span start that cannot be read rather than throwing', () => {
    const rows = activityTiming(
      [coded('x', 'block', '2026-08-24T01:00:00.000Z', {
        activity: 'gym',
        span: { start: 'nope', end: null, approx: false },
      })],
      window,
      SGT
    );
    expect(rows.rows).toEqual([]);
  });

  it('orders by how often, then by name, and never by locale', () => {
    const rows = activityTiming(
      [
        atActivity('a1', 'read', '2026-08-24T01:00:00.000Z'),
        atActivity('a2', 'read', '2026-08-24T02:00:00.000Z'),
        atActivity('b1', 'gym', '2026-08-24T03:00:00.000Z'),
        atActivity('c1', 'admin', '2026-08-24T04:00:00.000Z'),
      ],
      window,
      SGT
    );
    expect(rows.rows.map(row => row.activity)).toEqual(['read', 'admin', 'gym']);
  });

  it('draws the busiest and COUNTS the rest — a cap that hides its own existence is a lie', () => {
    const pulses = Array.from({ length: TIMING_ROWS + 3 }, (_, index) =>
      atActivity(`p${index}`, `activity-${index}`, '2026-08-24T01:00:00.000Z')
    );

    const rows = activityTiming(pulses, window, SGT);

    expect(rows.rows).toHaveLength(TIMING_ROWS);
    expect(rows.hidden).toBe(3);
  });

  it('gives every row twenty-four buckets, so an empty hour is drawn rather than missing', () => {
    const rows = activityTiming([atActivity('a', 'gym', '2026-08-24T01:00:00.000Z')], window, SGT);
    expect(rows.rows[0].hours).toHaveLength(24);
    expect(rows.rows[0].hours.filter(count => count === 0)).toHaveLength(23);
  });
});

describe('closing a span — Appendix D', () => {
  it('believes a stated end, even past the cap', () => {
    const spans = closeSpans(
      [coded('a', 'block', '2026-08-24T01:00:00.000Z', {
        span: { start: '2026-08-24T01:00:00.000Z', end: '2026-08-24T07:00:00.000Z', approx: false },
      })],
      SGT
    );
    expect(hoursOf(spans)).toEqual([6]);
    expect(spans[0].derived).toBe(false);
  });

  it('closes an open block at the next block', () => {
    const spans = closeSpans(
      [coded('a', 'block', '2026-08-24T01:00:00.000Z'), coded('b', 'block', '2026-08-24T02:30:00.000Z')],
      SGT
    );
    expect(hoursOf(spans)[0]).toBe(1.5);
    expect(spans[0].derived).toBe(true);
  });

  it('closes an open block at the next EVENT too', () => {
    const spans = closeSpans(
      [coded('a', 'block', '2026-08-24T01:00:00.000Z'), coded('b', 'event', '2026-08-24T02:00:00.000Z')],
      SGT
    );
    expect(hoursOf(spans)[0]).toBe(1);
  });

  it('caps an open block with nothing after it', () => {
    const spans = closeSpans([coded('a', 'block', '2026-08-24T01:00:00.000Z')], SGT);
    expect(spans[0].endMs - spans[0].startMs).toBe(OPEN_BLOCK_CAP_MS);
  });

  it('caps at the local day end before the four hours are up', () => {
    // 22:00 SGT on the 24th. Four hours would run to 02:00 on the 25th; the
    // day end takes it to 23:59:59.999 SGT instead — two hours, not four.
    const spans = closeSpans([coded('a', 'block', '2026-08-24T14:00:00.000Z')], SGT);
    expect(new Date(spans[0].endMs).toISOString()).toBe('2026-08-24T15:59:59.999Z');
  });

  it('lets the nearest of the three win when all apply', () => {
    const spans = closeSpans(
      [
        coded('a', 'block', '2026-08-24T14:00:00.000Z'),
        coded('b', 'block', '2026-08-24T14:30:00.000Z'),
      ],
      SGT
    );
    expect(hoursOf(spans)[0]).toBe(0.5);
  });

  it('never lets state, note or plan close a block or carry duration', () => {
    const spans = closeSpans(
      [
        coded('a', 'block', '2026-08-24T01:00:00.000Z'),
        coded('mood', 'state', '2026-08-24T01:30:00.000Z'),
        coded('jot', 'note', '2026-08-24T02:00:00.000Z'),
        coded('trip', 'plan', '2026-08-24T02:30:00.000Z'),
      ],
      SGT
    );
    expect(spans.map(span => span.pulseId)).toEqual(['a']);
    // The block ran to the cap: none of the three interrupted it.
    expect(spans[0].endMs - spans[0].startMs).toBe(OPEN_BLOCK_CAP_MS);
  });

  it('keeps task and claim out of Spent — the documented interpretation', () => {
    const spans = closeSpans(
      [coded('t', 'task', '2026-08-24T01:00:00.000Z'), coded('c', 'claim', '2026-08-24T02:00:00.000Z')],
      SGT
    );
    expect(spans).toEqual([]);
  });

  it('skips an uncoded pulse and an unreadable start rather than throwing', () => {
    const uncoded: PulseRow = { id: 'u', text: 'u', at: '2026-08-24T01:00:00.000Z' };
    const broken = coded('b', 'block', '2026-08-24T01:00:00.000Z', {
      span: { start: 'not a date', end: null, approx: false },
    });
    expect(closeSpans([uncoded, broken], SGT)).toEqual([]);
  });

  it('breaks a tie on the id, so two devices close the same week the same way', () => {
    // Two blocks on the same millisecond: whichever sorts first closes at the
    // other's start and is zero-length, so it contributes nothing and is
    // dropped. Which one that is must not depend on the order the fold
    // happened to return them in — the id decides, as it does in the fold's
    // own order key, and both devices drop the same one.
    const at = '2026-08-24T01:00:00.000Z';
    const forward = closeSpans([coded('b', 'block', at), coded('a', 'block', at)], SGT);
    const reversed = closeSpans([coded('a', 'block', at), coded('b', 'block', at)], SGT);
    expect(forward.map(span => span.pulseId)).toEqual(reversed.map(span => span.pulseId));
    expect(forward.map(span => span.pulseId)).toEqual(['b']);
  });

  it('carries the coding through to the span', () => {
    const spans = closeSpans(
      [
        coded('a', 'block', '2026-08-24T01:00:00.000Z', {
          domain: 'db',
          activity: 'deep-work',
          links: { eventId: null },
        }),
      ],
      SGT
    );
    expect(spans[0]).toMatchObject({ domain: 'db', activity: 'deep-work' });
  });
});

describe('spent by domain', () => {
  const week = weekWindow('2026-08-26', SGT);

  it('sums hours per domain, biggest first', () => {
    const spans = closeSpans(
      [
        coded('a', 'block', '2026-08-24T01:00:00.000Z', {
          domain: 'db',
          span: { start: '2026-08-24T01:00:00.000Z', end: '2026-08-24T03:00:00.000Z', approx: false },
        }),
        coded('b', 'block', '2026-08-25T01:00:00.000Z', {
          domain: 'self',
          span: { start: '2026-08-25T01:00:00.000Z', end: '2026-08-25T02:00:00.000Z', approx: false },
        }),
        coded('c', 'block', '2026-08-26T01:00:00.000Z', {
          domain: 'db',
          span: { start: '2026-08-26T01:00:00.000Z', end: '2026-08-26T02:00:00.000Z', approx: false },
        }),
      ],
      SGT
    );
    expect(spentByDomain(spans, week)).toEqual([
      { domain: 'db', hours: 3, derivedHours: 0 },
      { domain: 'self', hours: 1, derivedHours: 0 },
    ]);
  });

  it('gives each week only its own side of a span crossing the boundary', () => {
    // Sunday 23:00 SGT through Monday 01:00 SGT, stated.
    const spans = closeSpans(
      [
        coded('a', 'block', '2026-08-23T15:00:00.000Z', {
          domain: 'db',
          span: { start: '2026-08-23T15:00:00.000Z', end: '2026-08-23T17:00:00.000Z', approx: false },
        }),
      ],
      SGT
    );
    expect(spentByDomain(spans, weekWindow('2026-08-26', SGT))).toEqual([
      { domain: 'db', hours: 1, derivedHours: 0 },
    ]);
    expect(spentByDomain(spans, weekWindow('2026-08-19', SGT))).toEqual([
      { domain: 'db', hours: 1, derivedHours: 0 },
    ]);
  });

  it('keeps hours the coder gave no domain, and puts them last', () => {
    const spans = closeSpans(
      [
        coded('none', 'block', '2026-08-24T01:00:00.000Z', {
          span: { start: '2026-08-24T01:00:00.000Z', end: '2026-08-24T09:00:00.000Z', approx: false },
        }),
        coded('db', 'block', '2026-08-25T01:00:00.000Z', {
          domain: 'db',
          span: { start: '2026-08-25T01:00:00.000Z', end: '2026-08-25T02:00:00.000Z', approx: false },
        }),
      ],
      SGT
    );
    const bars = spentByDomain(spans, week);
    expect(bars.map(bar => bar.domain)).toEqual(['db', null]);
    expect(bars[1].hours).toBe(8);
  });

  it('separates the hours it inferred from the hours the owner stated', () => {
    const spans = closeSpans(
      [
        coded('stated', 'block', '2026-08-24T01:00:00.000Z', {
          domain: 'db',
          span: { start: '2026-08-24T01:00:00.000Z', end: '2026-08-24T02:00:00.000Z', approx: false },
        }),
        coded('open', 'block', '2026-08-25T01:00:00.000Z', { domain: 'db' }),
      ],
      SGT
    );
    expect(spentByDomain(spans, week)).toEqual([{ domain: 'db', hours: 5, derivedHours: 4 }]);
  });

  it('is empty on a week with nothing in it', () => {
    expect(spentByDomain([], week)).toEqual([]);
  });
});

describe('needed by calendar', () => {
  const week = weekWindow('2026-08-26', SGT);

  it('reads claims off the event id a pulse links to', () => {
    const pulses = [
      coded('a', 'claim', '2026-08-24T01:00:00.000Z', {
        links: { eventId: 'evt-1' },
      }),
      coded('b', 'note', '2026-08-24T02:00:00.000Z'),
    ];
    expect([...claimedEventIds(pulses)]).toEqual(['evt-1']);
  });

  it('counts home hours as zero until a pulse claims them', () => {
    const mirror = mirrorOf([timed('evt-1', 'home', '2026-08-24T01:00:00.000Z', '2026-08-24T03:00:00.000Z')]);
    expect(neededByCalendar(mirror, week, SGT, new Set())).toEqual([
      { calendar: 'home', hours: 0, allDay: 0, unclaimed: 2 },
    ]);
    expect(neededByCalendar(mirror, week, SGT, new Set(['evt-1']))).toEqual([
      { calendar: 'home', hours: 2, allDay: 0, unclaimed: 0 },
    ]);
  });

  it('bills every other calendar without asking for a claim', () => {
    const mirror = mirrorOf([timed('evt-2', 'db', '2026-08-24T01:00:00.000Z', '2026-08-24T04:00:00.000Z')]);
    expect(neededByCalendar(mirror, week, SGT, new Set())).toEqual([
      { calendar: 'db', hours: 3, allDay: 0, unclaimed: 0 },
    ]);
  });

  it('counts an all-day event rather than billing it twenty-four hours', () => {
    const mirror = mirrorOf([allDay('bday', 'personal', '2026-08-25', '2026-08-26')]);
    expect(neededByCalendar(mirror, week, SGT, new Set())).toEqual([
      { calendar: 'personal', hours: 0, allDay: 1, unclaimed: 0 },
    ]);
  });

  it('clips an event to the week it is being asked about', () => {
    const mirror = mirrorOf([timed('evt', 'db', '2026-08-23T15:00:00.000Z', '2026-08-23T17:00:00.000Z')]);
    expect(neededByCalendar(mirror, week, SGT, new Set())[0].hours).toBe(1);
  });

  it('is empty with no mirror at all', () => {
    expect(neededByCalendar(null, week, SGT, new Set())).toEqual([]);
  });
});

describe('needed against spent', () => {
  it('pairs only where the two names are the same word', () => {
    const paired = pairNeededSpent(
      [
        { calendar: 'db', hours: 10, allDay: 0, unclaimed: 0 },
        { calendar: 'home', hours: 2, allDay: 0, unclaimed: 3 },
      ],
      [
        { domain: 'db', hours: 8, derivedHours: 1 },
        { domain: 'self', hours: 4, derivedHours: 0 },
      ]
    );
    expect(paired.paired).toEqual([{ name: 'db', needed: 10, spent: 8 }]);
    expect(paired.neededOnly.map(row => row.calendar)).toEqual(['home']);
    expect(paired.spentOnly.map(row => row.domain)).toEqual(['self']);
  });

  it('never pairs the domainless bar with anything', () => {
    const paired = pairNeededSpent(
      [{ calendar: 'db', hours: 1, allDay: 0, unclaimed: 0 }],
      [{ domain: null, hours: 5, derivedHours: 0 }]
    );
    expect(paired.paired).toEqual([]);
    expect(paired.spentOnly).toEqual([{ domain: null, hours: 5, derivedHours: 0 }]);
  });
});

describe('the honesty line', () => {
  const week = weekWindow('2026-08-26', SGT);

  it('counts the week\'s pulses the coder never reached', () => {
    const pulses: PulseRow[] = [
      { id: 'u1', text: 'u', at: '2026-08-24T01:00:00.000Z' },
      { id: 'u2', text: 'u', at: '2026-08-25T01:00:00.000Z' },
      coded('c', 'block', '2026-08-25T02:00:00.000Z'),
    ];
    expect(ledgerHonesty(pulses, week)).toEqual({ uncoded: 2, captured: 3 });
  });

  it('counts by when it was said, which is all an uncoded pulse has', () => {
    const pulses: PulseRow[] = [{ id: 'u', text: 'u', at: '2026-08-17T01:00:00.000Z' }];
    expect(ledgerHonesty(pulses, week)).toEqual({ uncoded: 0, captured: 0 });
  });

  it('ignores a pulse whose instant cannot be read rather than throwing', () => {
    expect(ledgerHonesty([{ id: 'x', text: 'x', at: 'nope' }], week)).toEqual({
      uncoded: 0,
      captured: 0,
    });
  });
});

// ============================================================================
// Nutrition (phase 5)
// ============================================================================

/** A pulse that says the owner ate something. `nutrition` is the only field any of these assert on. */
function ate(
  id: string,
  at: string,
  nutrition: PulseRow['nutrition'],
  extra: Partial<PulseRow> = {}
): PulseRow {
  return { ...coded(id, 'note', at), nutrition, ...extra };
}

describe('dayNutrition', () => {
  it('splits a day into counted, estimated-within-counted, and uncounted, and sums protein across all of it', () => {
    const day = [
      // Stated: the owner's own figure, copied. It counts, and none of it is estimated.
      ate('breakfast', '2026-08-28T15:00:00.000Z', { kcal: 420, kcalSource: 'stated', proteinG: 30, proteinSource: 'stated' }),
      // Estimated: counted in full, and ALSO reported as the estimated share —
      // it is one number with a note about its provenance, not two numbers.
      ate('lunch', '2026-08-28T19:00:00.000Z', { kcal: 700, kcalSource: 'estimated', proteinG: 40, proteinSource: 'estimated' }),
      // Recognised and unsizeable: adds nothing to the total, counted separately.
      ate('buffet', '2026-08-28T22:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
      // Not food at all. Contributes to nothing, not even the uncounted tally.
      coded('meeting', 'block', '2026-08-28T17:00:00.000Z'),
    ];

    expect(dayNutrition(day, '2026-08-28', LA)).toEqual({
      kcal: 1120,
      estimatedKcal: 700,
      uncounted: 1,
      proteinG: 70,
      corrected: false,
    });
  });

  it('counts protein from a pulse whose calories are uncounted — the two figures are independent', () => {
    const day = [ate('shake', '2026-08-28T16:00:00.000Z', { kcal: null, kcalSource: 'estimated', proteinG: 25, proteinSource: 'stated' })];
    expect(dayNutrition(day, '2026-08-28', LA)).toEqual({
      kcal: 0,
      estimatedKcal: 0,
      uncounted: 1,
      proteinG: 25,
      corrected: false,
    });
  });

  it('buckets by the LOCAL day: 23:59 belongs to the day it was eaten on, 00:01 to the next', () => {
    // 06:59Z and 07:01Z on the 29th are 23:59 on the 28th and 00:01 on the
    // 29th in LA. A UTC `slice(0, 10)` puts both on the 29th, which silently
    // moves every late dinner west of Greenwich onto tomorrow's total.
    const lateDinner = ate('dinner', '2026-08-29T06:59:00.000Z', { kcal: 800, kcalSource: 'stated' });
    const midnightSnack = ate('snack', '2026-08-29T07:01:00.000Z', { kcal: 200, kcalSource: 'stated' });
    const both = [lateDinner, midnightSnack];

    expect(dayNutrition(both, '2026-08-28', LA).kcal).toBe(800);
    expect(dayNutrition(both, '2026-08-29', LA).kcal).toBe(200);

    // The same two instants, east of Greenwich, land on different days again —
    // the boundary is the zone's, never UTC's.
    expect(dayNutrition(both, '2026-08-29', SGT).kcal).toBe(1000);
  });

  it('is all zeros for a day with nothing eaten, so the view can tell "no food" from "no calories"', () => {
    expect(dayNutrition([coded('work', 'block', '2026-08-28T17:00:00.000Z')], '2026-08-28', LA)).toEqual({
      kcal: 0,
      estimatedKcal: 0,
      uncounted: 0,
      proteinG: 0,
      corrected: false,
    });
  });
});

describe('weekNutrition', () => {
  it('returns seven days including the empty ones, and sums the week\'s uncounted as one footnote', () => {
    const pulses = [
      ate('mon', '2026-08-24T19:00:00.000Z', { kcal: 900, kcalSource: 'stated' }),
      ate('wed', '2026-08-26T19:00:00.000Z', { kcal: 600, kcalSource: 'estimated' }),
      ate('wed-vague', '2026-08-26T21:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
      ate('sun', '2026-08-30T19:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
    ];

    const week = weekNutrition(pulses, '2026-08-26', LA, 1);

    // Seven bars, always. A blank Wednesday is a fact about the week; a chart
    // that dropped its empty days would draw a different shape every week.
    expect(week.days).toHaveLength(7);
    expect(week.days.map(day => day.date)).toEqual([
      '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30',
    ]);
    expect(week.days.map(day => day.kcal)).toEqual([900, 0, 600, 0, 0, 0, 0]);
    // Only Wednesday's was an estimate; Monday's was the owner's own number.
    expect(week.days.map(day => day.estimatedKcal)).toEqual([0, 0, 600, 0, 0, 0, 0]);
    // Both uncounted items, on two different days, in one tally.
    expect(week.uncounted).toBe(2);
  });
});

describe('kcalLabel', () => {
  it('separates thousands and rounds to whole calories, the same way on every device', () => {
    expect(kcalLabel(1240)).toBe('1,240');
    expect(kcalLabel(830.4)).toBe('830');
    expect(kcalLabel(0)).toBe('0');
  });
});

// ============================================================================
// Corrections, and the day food belongs to (rev 3)
// ============================================================================

/** A pulse carrying day totals the owner asserted. */
function corrects(id: string, at: string, corrections: PulseRow['corrections']): PulseRow {
  return { ...coded(id, 'note', at), corrections };
}

describe('items bucket by span.start — the day it was eaten, not the day it was said', () => {
  it('puts last night\'s supper on last night, when the coder back-dated the span', () => {
    // Said Saturday morning, eaten Friday evening. Bucketed by `at` this lands
    // on Saturday and no correction can move it — the day is not what is wrong.
    const retro: PulseRow = {
      ...coded('supper', 'note', '2026-08-29T16:00:00.000Z'),
      span: { start: '2026-08-29T03:00:00.000Z', end: null, approx: true },
      nutrition: { kcal: 900, kcalSource: 'estimated' },
    };

    // 2026-08-29T03:00Z is 20:00 on the 28th in LA; 16:00Z is 09:00 on the 29th.
    expect(dayNutrition([retro], '2026-08-28', LA).kcal).toBe(900);
    expect(dayNutrition([retro], '2026-08-29', LA).kcal).toBe(0);
  });

  it('leaves a 00:30 supper on the day it was actually eaten, rather than pushing it back', () => {
    // Eaten and said at 00:30 local, so the span starts there too. It belongs
    // to the new day: the rule is when the food happened, not what it felt like.
    const late: PulseRow = {
      ...coded('midnight-supper', 'note', '2026-08-29T07:30:00.000Z'),
      span: { start: '2026-08-29T07:30:00.000Z', end: null, approx: false },
      nutrition: { kcal: 500, kcalSource: 'estimated' },
    };

    expect(dayNutrition([late], '2026-08-29', LA).kcal).toBe(500);
    expect(dayNutrition([late], '2026-08-28', LA).kcal).toBe(0);
  });

  it('falls back to `at` for a pulse with no span at all', () => {
    const noSpan: PulseRow = {
      id: 'no-span',
      text: 'no-span',
      at: '2026-08-28T20:00:00.000Z',
      nutrition: { kcal: 400, kcalSource: 'estimated' },
    };
    expect(dayNutrition([noSpan], '2026-08-28', LA).kcal).toBe(400);
  });
});

describe('corrections', () => {
  it('subsumes everything eaten before it, and drops the provenance that no longer applies', () => {
    const day = [
      ate('under', '2026-08-28T19:00:00.000Z', { kcal: 1220, kcalSource: 'estimated' }),
      ate('vague', '2026-08-28T22:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
      // Said the next day, about that day.
      corrects('fix', '2026-08-29T18:00:00.000Z', [{ date: '2026-08-28', kcal: 2400 }]),
    ];

    expect(dayNutrition(day, '2026-08-28', LA)).toEqual({
      kcal: 2400,
      // No estimated share of a number the owner gave, and the unsizeable meal
      // is subsumed by it — that is what stating a day's total means.
      estimatedKcal: 0,
      uncounted: 0,
      proteinG: 0,
      corrected: true,
    });
  });

  it('ratifies a day exactly as it overrides one — the estimate stops being an estimate', () => {
    const day = [
      ate('sat', '2026-08-29T19:00:00.000Z', { kcal: 880, kcalSource: 'estimated' }),
      corrects('ok', '2026-08-29T23:00:00.000Z', [{ date: '2026-08-29', kcal: 880 }]),
    ];

    const total = dayNutrition(day, '2026-08-29', LA);
    // Same number, different fact: it is now the owner's, not the coder's, and
    // a ratification that changed nothing would leave it drawn as a guess.
    expect(total.kcal).toBe(880);
    expect(total.estimatedKcal).toBe(0);
    expect(total.corrected).toBe(true);
  });

  it('settles several days from one utterance', () => {
    const pulse = corrects('both', '2026-08-30T18:00:00.000Z', [
      { date: '2026-08-28', kcal: 2400 },
      { date: '2026-08-29', kcal: 880 },
    ]);

    expect(dayNutrition([pulse], '2026-08-28', LA).kcal).toBe(2400);
    expect(dayNutrition([pulse], '2026-08-29', LA).kcal).toBe(880);
    // And says nothing about any other day.
    expect(dayNutrition([pulse], '2026-08-30', LA).corrected).toBe(false);
  });

  it('carries item nutrition and a correction on the same pulse, each to its own day', () => {
    // "had a burrito, 620; friday was 2400" — one line, two kinds of claim.
    const pulse: PulseRow = {
      ...corrects('both-kinds', '2026-08-29T19:00:00.000Z', [{ date: '2026-08-28', kcal: 2400 }]),
      span: { start: '2026-08-29T19:00:00.000Z', end: null, approx: false },
      nutrition: { kcal: 620, kcalSource: 'stated' },
    };

    expect(dayNutrition([pulse], '2026-08-28', LA).kcal).toBe(2400);
    expect(dayNutrition([pulse], '2026-08-29', LA).kcal).toBe(620);
  });

  it('takes the newest correction for a day, and breaks a tie on id like everything else', () => {
    const day = [
      corrects('first', '2026-08-29T18:00:00.000Z', [{ date: '2026-08-28', kcal: 2400 }]),
      corrects('second', '2026-08-29T19:00:00.000Z', [{ date: '2026-08-28', kcal: 2600 }]),
    ];
    expect(dayNutrition(day, '2026-08-28', LA).kcal).toBe(2600);

    // Same instant: id decides, larger last, so both devices agree on which stands.
    const tied = [
      corrects('a', '2026-08-29T18:00:00.000Z', [{ date: '2026-08-28', kcal: 1000 }]),
      corrects('b', '2026-08-29T18:00:00.000Z', [{ date: '2026-08-28', kcal: 2000 }]),
    ];
    expect(dayNutrition(tied, '2026-08-28', LA).kcal).toBe(2000);
    expect(dayNutrition([...tied].reverse(), '2026-08-28', LA).kcal).toBe(2000);
  });

  it('takes the last entry for a day within one pulse', () => {
    const pulse = corrects('twice', '2026-08-29T18:00:00.000Z', [
      { date: '2026-08-28', kcal: 2400 },
      { date: '2026-08-28', kcal: 2500 },
    ]);
    expect(dayNutrition([pulse], '2026-08-28', LA).kcal).toBe(2500);
  });

  it('falls back when the correcting pulse is deleted — undo is deleting the line', () => {
    const items = [ate('under', '2026-08-28T19:00:00.000Z', { kcal: 1220, kcalSource: 'estimated' })];
    const fix = corrects('fix', '2026-08-29T18:00:00.000Z', [{ date: '2026-08-28', kcal: 2400 }]);

    expect(dayNutrition([...items, fix], '2026-08-28', LA).kcal).toBe(2400);

    // The pulse is gone; the selector has nothing to prefer and the arithmetic
    // is back. There is no separate uncorrect gesture and none is needed.
    const after = dayNutrition(items, '2026-08-28', LA);
    expect(after.kcal).toBe(1220);
    expect(after.corrected).toBe(false);

    // An older correction underneath a deleted newer one comes back the same way.
    const older = corrects('older', '2026-08-29T09:00:00.000Z', [{ date: '2026-08-28', kcal: 2000 }]);
    expect(dayNutrition([...items, older], '2026-08-28', LA).kcal).toBe(2000);
  });
});

describe('a correction is a waterline, not a lid', () => {
  it('adds what was eaten after it on top of the figure the owner stated', () => {
    const day = [
      ate('lunch', '2026-08-29T16:00:00.000Z', { kcal: 780, kcalSource: 'estimated' }),
      // Midday, reading the ledger and saying what it has come to so far.
      corrects('so-far', '2026-08-29T19:00:00.000Z', [{ date: '2026-08-29', kcal: 880 }]),
      ate('tofu', '2026-08-29T21:00:00.000Z', { kcal: 100, kcalSource: 'stated' }),
    ];

    // Read as a lid this sat at 880 for the rest of the day and every meal
    // after lunch was discarded, with nothing on screen to say why. Measured
    // on real data, 2026-08-29, and it is the reason this rule exists.
    expect(dayNutrition(day, '2026-08-29', LA).kcal).toBe(980);
  });

  it('reports the provenance of what came after it, and none for the stated part', () => {
    const day = [
      ate('morning', '2026-08-29T16:00:00.000Z', { kcal: 500, kcalSource: 'estimated' }),
      corrects('so-far', '2026-08-29T19:00:00.000Z', [{ date: '2026-08-29', kcal: 880 }]),
      ate('supper', '2026-08-29T20:00:00.000Z', { kcal: 400, kcalSource: 'estimated' }),
      ate('vague', '2026-08-29T21:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
    ];

    expect(dayNutrition(day, '2026-08-29', LA)).toEqual({
      kcal: 1280,
      // The supper's, and only the supper's: there is no estimated share of a
      // figure the owner stated, and the morning is inside that figure.
      estimatedKcal: 400,
      // Likewise — the unsizeable meal is after the waterline, so it is a fact
      // about the day the number does not cover, and it has to show.
      uncounted: 1,
      proteinG: 0,
      corrected: true,
    });
  });

  it('subsumes a meal counted in the same breath as the total', () => {
    // "had a burrito, 620 — so today's 1500 so far" is one utterance, and they
    // counted the burrito before saying 1500. The instants are equal, so the
    // comparison has to be strict or the 620 lands twice.
    const pulse: PulseRow = {
      ...corrects('same-breath', '2026-08-29T19:00:00.000Z', [{ date: '2026-08-29', kcal: 1500 }]),
      nutrition: { kcal: 620, kcalSource: 'stated' },
    };

    expect(dayNutrition([pulse], '2026-08-29', LA).kcal).toBe(1500);
  });

  it('moves the waterline with the newer correction rather than counting the gap twice', () => {
    const day = [
      corrects('first', '2026-08-29T19:00:00.000Z', [{ date: '2026-08-29', kcal: 880 }]),
      ate('snack', '2026-08-29T20:00:00.000Z', { kcal: 200, kcalSource: 'stated' }),
      // Two hours on, they total again — and 1,200 already includes the snack.
      corrects('second', '2026-08-29T21:00:00.000Z', [{ date: '2026-08-29', kcal: 1200 }]),
      ate('supper', '2026-08-29T22:00:00.000Z', { kcal: 300, kcalSource: 'stated' }),
    ];

    expect(dayNutrition(day, '2026-08-29', LA).kcal).toBe(1500);
  });

  it('leaves a settled day settled when food is remembered for it afterwards', () => {
    // "friday was 2400", said Saturday; on Sunday a Friday beer is remembered.
    // It buckets to Friday, correctly — but it was EATEN under the waterline,
    // and a total stated from memory of the whole day already covers it.
    const beer: PulseRow = {
      ...coded('beer', 'note', '2026-08-30T19:00:00.000Z'),
      span: { start: '2026-08-29T03:00:00.000Z', end: null, approx: true },
      nutrition: { kcal: 150, kcalSource: 'estimated' },
    };
    const fix = corrects('fix', '2026-08-29T19:00:00.000Z', [{ date: '2026-08-28', kcal: 2400 }]);

    expect(dayNutrition([beer, fix], '2026-08-28', LA).kcal).toBe(2400);
  });

  it('adds protein eaten after a stated protein figure', () => {
    const day = [
      ate('lunch', '2026-08-29T16:00:00.000Z', { kcal: 700, kcalSource: 'estimated', proteinG: 40, proteinSource: 'estimated' }),
      corrects('so-far', '2026-08-29T19:00:00.000Z', [{ date: '2026-08-29', kcal: 880, proteinG: 60 }]),
      ate('shake', '2026-08-29T20:00:00.000Z', { kcal: 200, kcalSource: 'stated', proteinG: 25, proteinSource: 'stated' }),
    ];

    // The lunch's 40 g is inside the stated 60; the shake's 25 is not.
    expect(dayNutrition(day, '2026-08-29', LA).proteinG).toBe(85);
  });
});

describe('protein on a corrected day', () => {
  it('keeps the item sum when the correction says nothing about protein', () => {
    const day = [
      ate('lunch', '2026-08-28T19:00:00.000Z', { kcal: 700, kcalSource: 'estimated', proteinG: 40, proteinSource: 'estimated' }),
      corrects('fix', '2026-08-29T18:00:00.000Z', [{ date: '2026-08-28', kcal: 2400 }]),
    ];
    const total = dayNutrition(day, '2026-08-28', LA);

    // "friday was 2400" is a claim about calories. Throwing the item sum away
    // would silently zero a protein figure the owner never disputed.
    expect(total.kcal).toBe(2400);
    expect(total.proteinG).toBe(40);
  });

  it('takes the correction\'s protein when it gives one', () => {
    const day = [
      ate('lunch', '2026-08-28T19:00:00.000Z', { kcal: 700, kcalSource: 'estimated', proteinG: 40, proteinSource: 'estimated' }),
      corrects('fix', '2026-08-29T18:00:00.000Z', [{ date: '2026-08-28', kcal: 2400, proteinG: 150 }]),
    ];
    expect(dayNutrition(day, '2026-08-28', LA).proteinG).toBe(150);
  });

  it('takes a corrected protein of zero as a real claim, not as absent', () => {
    const day = [
      ate('lunch', '2026-08-28T19:00:00.000Z', { kcal: 700, kcalSource: 'estimated', proteinG: 40, proteinSource: 'estimated' }),
      corrects('fix', '2026-08-29T18:00:00.000Z', [{ date: '2026-08-28', kcal: 2400, proteinG: 0 }]),
    ];
    expect(dayNutrition(day, '2026-08-28', LA).proteinG).toBe(0);
  });
});

describe('weekNutrition with corrections', () => {
  it('marks the corrected days so the chart can stop drawing them as estimates', () => {
    const pulses = [
      ate('mon', '2026-08-24T19:00:00.000Z', { kcal: 900, kcalSource: 'estimated' }),
      ate('tue', '2026-08-25T19:00:00.000Z', { kcal: 700, kcalSource: 'estimated' }),
      corrects('fix', '2026-08-26T19:00:00.000Z', [{ date: '2026-08-24', kcal: 2400 }]),
    ];

    const week = weekNutrition(pulses, '2026-08-26', LA, 1);
    expect(week.days[0]).toEqual({ date: '2026-08-24', kcal: 2400, estimatedKcal: 0, corrected: true });
    expect(week.days[1]).toEqual({ date: '2026-08-25', kcal: 700, estimatedKcal: 700, corrected: false });
  });

  it('drops a corrected day\'s uncounted items from the week\'s footnote', () => {
    const pulses = [
      ate('vague', '2026-08-24T19:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
      ate('also-vague', '2026-08-25T19:00:00.000Z', { kcal: null, kcalSource: 'estimated' }),
      corrects('fix', '2026-08-26T19:00:00.000Z', [{ date: '2026-08-24', kcal: 2400 }]),
    ];

    // Monday's unsizeable meal is inside the owner's stated total now. Tuesday's
    // is still genuinely uncounted.
    expect(weekNutrition(pulses, '2026-08-26', LA, 1).uncounted).toBe(1);
  });
});

/**
 * The ghost a deleted-then-enriched pulse used to leave in the ledger.
 *
 * Not pure, unlike everything above: the whole point is the seam between the
 * fold and the row reader, so these drive the real service — capture, delete,
 * enrich — and read back through `getPulses`, which is `readPulseRows`. Hand-
 * built rows could not show it, because the row that used to reach the ledger
 * was one nothing in the app ever constructed on purpose.
 *
 * `fold` still resurrects such an entity, and test three pins that it does.
 * Journal-level resurrection is the contract for all twelve entities; what
 * changed is that a folded pulse with no `text` is not a pulse this replica
 * captured, so no reader returns it.
 */
describe('a deleted pulse enriched afterwards never reaches the ledger', () => {
  beforeEach(() => {
    resetSession();
  });
  afterEach(async () => {
    resetSession();
    await closeDb();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('meridian');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'));
    });
  });

  /** A coding carrying only what the ledger reads. */
  function coding(nutrition: Coding['nutrition'], corrections: Coding['corrections'] = []): Coding {
    return {
      signal: 'note',
      domain: null,
      activity: null,
      people: [],
      span: { start: '2026-08-28T19:00:00.000Z', end: null, approx: false },
      links: { eventId: null },
      nutrition,
      corrections,
      coderRev: CODER_REV,
      effects: [],
      vocabProposal: null,
    };
  }

  it('does not count a deleted meal\'s calories, while the meal beside it still counts', async () => {
    const deleted = await createPulse('a burrito');
    const kept = await createPulse('an apple');
    await deletePulse(deleted.id);

    // The coder was already running when the delete landed. Both enrichments
    // are written; only one of them has a pulse left to attach to.
    await enrichPulse(deleted.id, coding({ kcal: 620, kcalSource: 'estimated' }));
    await enrichPulse(kept.id, coding({ kcal: 500, kcalSource: 'stated' }));

    const rows = await getPulses();
    expect(rows.map((row) => row.id)).toEqual([kept.id]);

    // 620 + 500 was the old number, and nothing on screen said where the 620
    // came from — the line it was eaten with had been deleted hours earlier.
    expect(dayNutrition(rows, '2026-08-28', LA)).toEqual({
      kcal: 500,
      estimatedKcal: 0,
      uncounted: 0,
      proteinG: 0,
      corrected: false,
    });
  });

  it('lets no deleted correction stand: the day falls back to the sum of its items', async () => {
    const meal = await createPulse('an apple');
    await enrichPulse(meal.id, coding({ kcal: 500, kcalSource: 'stated' }));

    const correction = await createPulse('scratch that, tuesday was 2400');
    await deletePulse(correction.id);
    await enrichPulse(correction.id, coding(null, [{ date: '2026-08-28', kcal: 2400 }]));

    const rows = await getPulses();
    expect(rows.map((row) => row.id)).toEqual([meal.id]);

    // The worst shape of the ghost. A correction is a waterline — it subsumes
    // what came before and adds what came after — and a resurrected one has no
    // `at`, so it sits at the epoch floor with the whole day after it. The old
    // reading was 2400 + 500, from a sentence the owner had already retracted.
    const total = dayNutrition(rows, '2026-08-28', LA);
    expect(total.corrected).toBe(false);
    expect(total.kcal).toBe(500);
  });

  it('excludes it across devices too: A captures and deletes, B enriches, and the fold still resurrects it', async () => {
    const captured: JournalEvent = {
      id: 'e-capture',
      device: 'a',
      seq: 1,
      ts: 100,
      type: 'upsert',
      entity: ENTITY.pulse,
      entityId: 'p-ghost',
      fields: { text: 'a burrito', at: '2026-08-28T19:00:00.000Z' },
    };
    const removed: JournalEvent = {
      id: 'e-delete',
      device: 'a',
      seq: 2,
      ts: 200,
      type: 'delete',
      entity: ENTITY.pulse,
      entityId: 'p-ghost',
    };
    // B had not synced the delete when it coded the pulse, so its enrichment is
    // the newest event and resurrects the entity. Fence 1 keeps `text` out of
    // it, which is exactly what makes the ghost recognisable.
    const enriched: JournalEvent = {
      id: 'e-enrich',
      device: 'b',
      seq: 1,
      ts: 300,
      type: 'upsert',
      entity: ENTITY.pulse,
      entityId: 'p-ghost',
      fields: {
        signal: 'note',
        span: { start: '2026-08-28T19:00:00.000Z', end: null, approx: false },
        nutrition: { kcal: 620, kcalSource: 'estimated' },
        coderRev: CODER_REV,
      },
    };

    // The journal's own answer is unchanged, and must stay unchanged: the
    // entity is back, carrying only what B wrote, with no `text` among it.
    const folded = fold([captured, removed, enriched]);
    expect(folded.warnings).toEqual([]);
    expect(folded.state.pulse?.['p-ghost']).toMatchObject({ nutrition: { kcal: 620 } });
    expect(folded.state.pulse?.['p-ghost']).not.toHaveProperty('text');

    // The reader's answer is where it stops.
    await enqueue([captured, removed, enriched]);
    resetSession();
    const rows = await getPulses();
    expect(rows).toEqual([]);

    expect(dayNutrition(rows, '2026-08-28', LA)).toEqual({
      kcal: 0,
      estimatedKcal: 0,
      uncounted: 0,
      proteinG: 0,
      corrected: false,
    });
  });
});
