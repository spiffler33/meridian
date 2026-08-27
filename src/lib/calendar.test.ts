/**
 * The calendar mirror's parser and selectors.
 *
 * What carries real risk here is time, in three specific ways.
 *
 * An all-day event's end is exclusive, so an off-by-one puts a phantom second
 * day on every one of them. An all-day event's dates are literal and must not
 * pass through a timezone, or a birthday moves a day west of Greenwich. And a
 * timed event is an instant, so which local day it lands on depends on the
 * device — 16:30Z is tomorrow in Singapore and today in California.
 *
 * The rest is the honesty contract: a file that will not parse comes back as a
 * reason rather than an exception, events dropped for bad fields are counted
 * rather than silently lost, and staleness is only claimed during the hours
 * the mirror is actually supposed to be running.
 */

import { describe, expect, it } from 'vitest';

import {
  STALE_AFTER_MS,
  dayKey,
  daysTouched,
  eventsForDay,
  eventsForDays,
  isMirrorStale,
  parseCalendar,
  type CalendarEvent,
} from './calendar';

const SGT = 'Asia/Singapore';
const LA = 'America/Los_Angeles';

const timed = (
  id: string,
  start: string,
  end: string,
  extra: Partial<CalendarEvent> = {}
): CalendarEvent => ({
  id,
  calendar: 'home',
  title: id,
  start,
  end,
  allDay: false,
  location: null,
  ...extra,
});

const allDay = (id: string, start: string, end: string): CalendarEvent => ({
  id,
  calendar: 'personal',
  title: id,
  start,
  end,
  allDay: true,
  location: null,
});

const FILE = JSON.stringify({
  generated_at: '2026-08-27T04:10:31Z',
  content_hash: 'abc',
  window: { start: '2026-08-20', end: '2026-10-26' },
  calendars: ['db', 'home', 'personal'],
  events: [
    {
      id: '0123456789abcdef',
      calendar: 'home',
      title: 'standup',
      start: '2026-08-27T01:30:00Z',
      end: '2026-08-27T02:00:00Z',
      allDay: false,
      location: 'the kitchen',
    },
    {
      id: 'fedcba9876543210',
      calendar: 'personal',
      title: 'trip',
      start: '2026-08-28',
      end: '2026-08-30',
      allDay: true,
    },
  ],
});

describe('parsing the mirror file', () => {
  it('reads the whole file', () => {
    const { mirror, error, skipped } = parseCalendar(FILE);

    expect(error).toBeNull();
    expect(skipped).toBe(0);
    expect(mirror?.generatedAt).toBe(Date.parse('2026-08-27T04:10:31Z'));
    expect(mirror?.window).toEqual({ start: '2026-08-20', end: '2026-10-26' });
    expect(mirror?.calendars).toEqual(['db', 'home', 'personal']);
    expect(mirror?.events).toHaveLength(2);
  });

  it('carries a location where there is one and null where there is not', () => {
    const events = parseCalendar(FILE).mirror?.events ?? [];

    expect(events[0].location).toBe('the kitchen');
    expect(events[1].location).toBeNull();
  });

  it.each([
    ['not json at all', 'this is not json'],
    ['json that is not an object', '"a string"'],
    ['an object with no generated_at', '{"events":[]}'],
    ['an object with no events list', '{"generated_at":"2026-08-27T04:10:31Z"}'],
    ['a generated_at that is not a date', '{"generated_at":"never","events":[]}'],
  ])('refuses %s without throwing', (_case, text) => {
    const { mirror, error } = parseCalendar(text);

    expect(mirror).toBeNull();
    expect(error).not.toBeNull();
  });

  it('counts the events it had to drop instead of losing them quietly', () => {
    const text = JSON.stringify({
      generated_at: '2026-08-27T04:10:31Z',
      events: [
        { id: 'a', calendar: 'home', title: 't', start: 's', end: 'e', allDay: false },
        { id: 'b', calendar: 'home', start: 's', end: 'e', allDay: false },
        { id: 'c', calendar: 'home', title: 't', start: 's', end: 'e' },
        null,
      ],
    });

    const { mirror, skipped } = parseCalendar(text);

    expect(mirror?.events.map(event => event.id)).toEqual(['a']);
    expect(skipped).toBe(3);
  });
});

describe('the local day an instant falls on', () => {
  it('is a different date either side of the dateline', () => {
    const at = Date.parse('2026-08-26T16:30:00Z');

    expect(dayKey(at, SGT)).toBe('2026-08-27');
    expect(dayKey(at, LA)).toBe('2026-08-26');
  });
});

describe('the days an event touches', () => {
  it('is one day for an event inside a day', () => {
    const event = timed('a', '2026-08-27T01:30:00Z', '2026-08-27T02:00:00Z');

    expect(daysTouched(event, SGT)).toEqual(['2026-08-27']);
  });

  it('is both days for an event that crosses local midnight', () => {
    // 23:00–01:00 SGT.
    const event = timed('a', '2026-08-26T15:00:00Z', '2026-08-26T17:00:00Z');

    expect(daysTouched(event, SGT)).toEqual(['2026-08-26', '2026-08-27']);
  });

  it('stops at the day it ends on when it ends exactly at midnight', () => {
    // 22:00–00:00 SGT: the last minute belongs to the 26th, not the 27th.
    const event = timed('a', '2026-08-26T14:00:00Z', '2026-08-26T16:00:00Z');

    expect(daysTouched(event, SGT)).toEqual(['2026-08-26']);
  });

  it('spans every day of a long meeting', () => {
    const event = timed('a', '2026-08-26T01:00:00Z', '2026-08-28T09:00:00Z');

    expect(daysTouched(event, SGT)).toEqual(['2026-08-26', '2026-08-27', '2026-08-28']);
  });

  it('treats an all-day end date as exclusive', () => {
    expect(daysTouched(allDay('a', '2026-08-26', '2026-08-27'), SGT)).toEqual(['2026-08-26']);
    expect(daysTouched(allDay('b', '2026-08-28', '2026-08-31'), SGT)).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('puts an all-day event on the same dates in every timezone', () => {
    const event = allDay('a', '2026-08-26', '2026-08-27');

    expect(daysTouched(event, LA)).toEqual(daysTouched(event, SGT));
  });

  it('still yields a day when the end is not after the start', () => {
    expect(daysTouched(allDay('a', '2026-08-26', '2026-08-26'), SGT)).toEqual(['2026-08-26']);
    expect(
      daysTouched(timed('b', '2026-08-26T01:00:00Z', '2026-08-26T01:00:00Z'), SGT)
    ).toEqual(['2026-08-26']);
  });
});

describe('one day of events', () => {
  const mirror = {
    generatedAt: 0,
    window: { start: '', end: '' },
    calendars: [],
    events: [
      timed('late', '2026-08-27T06:00:00Z', '2026-08-27T07:00:00Z'),
      allDay('span', '2026-08-27', '2026-08-28'),
      timed('early', '2026-08-27T01:30:00Z', '2026-08-27T02:00:00Z'),
      timed('other-day', '2026-08-29T01:30:00Z', '2026-08-29T02:00:00Z'),
    ],
  };

  it('is all-day first, then by start', () => {
    expect(eventsForDay(mirror, '2026-08-27', SGT).map(event => event.id)).toEqual([
      'span',
      'early',
      'late',
    ]);
  });

  it('leaves out the days that are not asked for', () => {
    expect(eventsForDay(mirror, '2026-08-28', SGT)).toEqual([]);
  });

  it('breaks a tie on id, so two events at one minute never swap', () => {
    const same = {
      ...mirror,
      events: [
        timed('b', '2026-08-27T01:00:00Z', '2026-08-27T02:00:00Z'),
        timed('a', '2026-08-27T01:00:00Z', '2026-08-27T02:00:00Z'),
      ],
    };

    expect(eventsForDay(same, '2026-08-27', SGT).map(event => event.id)).toEqual(['a', 'b']);
  });

  it('is empty rather than a throw when there is no mirror', () => {
    expect(eventsForDay(null, '2026-08-27', SGT)).toEqual([]);
  });
});

describe('a week of events', () => {
  // The app's week starts Monday (getWeekDates, weekStartsOn: 1).
  const week = [
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
    '2026-08-30',
  ];

  const mirror = {
    generatedAt: 0,
    window: { start: '', end: '' },
    calendars: [],
    events: [
      // 23:00 Sunday the 30th — the last hour of the week, and the first of
      // the next day, which is outside it.
      timed('sunday-night', '2026-08-30T15:00:00Z', '2026-08-30T17:00:00Z'),
      timed('monday-open', '2026-08-24T01:00:00Z', '2026-08-24T02:00:00Z'),
      // Runs from before the week into it.
      allDay('carried', '2026-08-22', '2026-08-26'),
    ],
  };

  it('keys every day asked for, including the empty ones', () => {
    const days = eventsForDays(mirror, week, SGT);

    expect([...days.keys()]).toEqual(week);
    expect(days.get('2026-08-27')).toEqual([]);
  });

  it('puts the boundary days on the right side', () => {
    const days = eventsForDays(mirror, week, SGT);

    expect(days.get('2026-08-24')?.map(event => event.id)).toEqual(['carried', 'monday-open']);
    expect(days.get('2026-08-30')?.map(event => event.id)).toEqual(['sunday-night']);
    // It also runs into the 31st, which is not this week and is not invented.
    expect(days.has('2026-08-31')).toBe(false);
  });

  it('drops the part of a span that falls before the week', () => {
    const days = eventsForDays(mirror, week, SGT);

    expect(days.get('2026-08-25')?.map(event => event.id)).toEqual(['carried']);
    expect(days.get('2026-08-26')?.map(event => event.id)).toEqual([]);
  });

  it('is all buckets and no events when there is no mirror', () => {
    const days = eventsForDays(null, week, SGT);

    expect([...days.keys()]).toEqual(week);
    expect([...days.values()].flat()).toEqual([]);
  });
});

describe('staleness', () => {
  // 12:00 SGT, in the middle of the hours the action runs.
  const midday = Date.parse('2026-08-27T04:00:00Z');
  // 03:00 SGT, when it is not scheduled to run at all.
  const night = Date.parse('2026-08-26T19:00:00Z');

  it('is quiet while the mirror is keeping up', () => {
    expect(isMirrorStale(midday - 30 * 60_000, midday)).toBe(false);
  });

  it('says so once two runs have been missed', () => {
    expect(isMirrorStale(midday - 100 * 60_000, midday)).toBe(true);
  });

  it('is not tripped by the threshold exactly', () => {
    expect(isMirrorStale(midday - STALE_AFTER_MS, midday)).toBe(false);
  });

  it('stays quiet outside the hours the action runs', () => {
    expect(isMirrorStale(night - 5 * 3_600_000, night)).toBe(false);
  });

  it('wakes up at 06:00 SGT', () => {
    const six = Date.parse('2026-08-26T22:00:00Z');

    expect(isMirrorStale(six - 5 * 3_600_000, six)).toBe(true);
  });

  it('claims nothing about a mirror that has never been read', () => {
    expect(isMirrorStale(null, midday)).toBe(false);
  });
});
