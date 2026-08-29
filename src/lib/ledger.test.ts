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
 * Pure throughout — no IndexedDB, no fetch. Two zones on either side of UTC
 * are used deliberately: a bug that reads a local day off `slice(0, 10)`
 * passes in Europe and fails in both of them.
 */

import { describe, expect, it } from 'vitest';

import type { CalendarEvent, CalendarMirror } from './calendar';
import type { PulseRow, PulseSignal } from './entities';
import {
  claimedEventIds,
  closeSpans,
  endOfLocalDayMs,
  ledgerHonesty,
  localHour,
  neededByCalendar,
  OPEN_BLOCK_CAP_MS,
  pairNeededSpent,
  spentByDomain,
  startOfLocalDayMs,
  weekWindow,
} from './ledger';

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
