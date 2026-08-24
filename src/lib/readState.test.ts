/**
 * The backlog rule.
 *
 * Two decisions live here and nowhere else: what the baseline covers, and what
 * counts as material that can be behind at all. Both are load-bearing — the
 * first is why day one is not three hundred alarms, the second is why a wiki
 * never nags — so both are pinned here rather than inferred from a screen.
 */

import { describe, expect, it } from 'vitest';

import { baselineDay, countUnread, isUnread, readDaysOf } from './readState';

const AFTER = { key: 'raw:2026-08-21--lex', date: '2026-08-21' };
const BEFORE = { key: 'raw:2026-07-02--old', date: '2026-07-02' };
const UNDATED = { key: 'essay:profit-is-the-wire', date: null };

const NONE: ReadonlySet<string> = new Set();

describe('the baseline', () => {
  it('is a day, taken from the timestamp the profile carries', () => {
    expect(baselineDay('2026-08-16T17:04:09.123Z')).toBe('2026-08-16');
  });

  it('is absent rather than guessed when the profile has none', () => {
    expect(baselineDay(null)).toBeNull();
  });

  it('is absent rather than half-read when the value is too short to be a date', () => {
    expect(baselineDay('2026-08')).toBeNull();
  });
});

describe('what is unread', () => {
  const day = '2026-08-16';

  it('counts material published after the mark', () => {
    expect(isUnread(AFTER, day, NONE)).toBe(true);
  });

  it('leaves everything the mark covers alone — it was read in email', () => {
    expect(isUnread(BEFORE, day, NONE)).toBe(false);
  });

  it('counts the mark day itself, because a date cannot be placed inside a day', () => {
    // Rounding the baseline day to "already read" would hide an entry
    // published later the same day forever. Rounding it the other way costs
    // one tap.
    expect(isUnread({ key: 'raw:same-day', date: day }, day, NONE)).toBe(true);
  });

  it('never counts undated material: a reference is not a queue', () => {
    expect(isUnread(UNDATED, day, NONE)).toBe(false);
    expect(isUnread({ key: 'canon:doc/1', date: '' }, day, NONE)).toBe(false);
  });

  it('stops counting the moment it is marked', () => {
    expect(isUnread(AFTER, day, new Set([AFTER.key]))).toBe(false);
  });

  it('reports nothing at all before a baseline exists, rather than zero', () => {
    expect(isUnread(AFTER, null, NONE)).toBe(false);
    expect(countUnread([AFTER, BEFORE], null, NONE)).toBeNull();
  });

  it('adds up only what is genuinely behind', () => {
    expect(countUnread([AFTER, BEFORE, UNDATED], '2026-08-16', NONE)).toBe(1);
    expect(countUnread([AFTER, BEFORE, UNDATED], '2026-01-01', NONE)).toBe(2);
    expect(countUnread([AFTER, BEFORE, UNDATED], '2026-01-01', new Set([BEFORE.key]))).toBe(1);
  });
});

describe('the days something was read on', () => {
  it('takes the day out of each mark, and says each day once', () => {
    expect(
      readDaysOf([
        { read_at: '2026-08-24T09:00:00.000Z' },
        { read_at: '2026-08-24T21:40:00.000Z' },
        { read_at: '2026-08-23T07:15:00.000Z' },
      ])
    ).toEqual(new Set(['2026-08-24', '2026-08-23']));
  });

  it('skips a mark whose timestamp is too short to name a day', () => {
    expect(readDaysOf([{ read_at: '' }, { read_at: '2026-08-24T09:00:00.000Z' }])).toEqual(
      new Set(['2026-08-24'])
    );
  });
});
