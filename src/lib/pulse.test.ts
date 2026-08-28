/**
 * Pulse: the fold's read path for one entity, and the pure day/order rules
 * the stream renders through.
 *
 * `pulse` is the newest entity the fold has ever had to carry, so this file
 * pins two separate things. First, that the general fold contract — an
 * upsert creates, a delete tombstones, a later upsert resurrects carrying
 * only its own fields — holds for `pulse` exactly as it does for every other
 * entity, read back through the real service (`getPulses`) rather than only
 * asserted against the raw folded record. Second, that `pulsesForDay` buckets
 * by the LOCAL day in the given zone rather than the UTC day `at` happens to
 * fall on — the bug a naive `slice(0, 10)` would reintroduce — and that its
 * ordering (oldest first, id breaks a tie) is exactly what
 * `compareOldestFirst` says it is.
 *
 * The order used to be newest first. It flipped when the capture box moved to
 * the foot of the Pulse page: chronological is what keeps the newest line
 * sitting next to the box, which is Gate 1's answer to the question the plan
 * asked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dayKey, deviceTimeZone, EVENTS_PATH } from './calendar';
import { closeDb, enqueue, outboxSize, peekOutbox, putCachedContent } from './db';
import type { OutboxRecord } from './db';
import { ENTITY, resetSession } from './entities';
import type { PulseRow } from './entities';
import { fold } from './journal';
import type { JournalEvent } from './journal';
import { compareOldestFirst, pulsesForDay } from './pulse';
import { addDays, getToday } from '../utils/dates';
import {
  codeCapturedPulse,
  codeUncodedPulses,
  createHabit,
  createPulse,
  createTowerItem,
  deletePulse,
  enrichPulse,
  ensurePulseVocabSeeded,
  getPulses,
  MAX_PULSES_PER_SWEEP,
  toggleCompletion,
} from '../services/data';
import type { Coding } from '../services/coder';

/**
 * `codeUncodedPulses` calls the real coder module for everything except the
 * network call itself — mocking only `codePulse` lets these tests drive the
 * real context assembly, the real enrichment write, and the real fold, and
 * assert on the one seam that would otherwise need a live API key.
 */
const codePulseMock = vi.hoisted(() => vi.fn());
vi.mock('../services/coder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/coder')>();
  return { ...actual, codePulse: codePulseMock };
});

const SAMPLE_CODING: Coding = {
  signal: 'task',
  domain: 'db',
  activity: 'deep-work',
  people: [],
  span: { start: '2026-08-28T09:00:00.000Z', end: null, approx: false },
  links: { habitId: null, towerId: null, eventId: null },
  effects: [{ type: 'spawnTask', text: 'call the plumber' }],
  vocabProposal: { kind: 'activity', value: 'plumbing', mapsTo: 'home-ops' },
};

/**
 * The six fields a coded pulse shows BACK to the coder in `recentPulses`.
 * Not what `enrichPulse` writes — the row stores the whole coding, proposals
 * included — but what Appendix B's allowlist permits into the next payload.
 */
const SAMPLE_ENRICHMENT = {
  signal: SAMPLE_CODING.signal,
  domain: SAMPLE_CODING.domain,
  activity: SAMPLE_CODING.activity,
  people: SAMPLE_CODING.people,
  span: SAMPLE_CODING.span,
  links: SAMPLE_CODING.links,
};

type UpsertEvent = Extract<JournalEvent, { type: 'upsert' }>;
type DeleteEvent = Extract<JournalEvent, { type: 'delete' }>;

function upsert(spec: {
  id: string;
  device: string;
  seq: number;
  ts: number;
  entityId: string;
  fields: Record<string, unknown>;
}): UpsertEvent {
  return {
    id: spec.id,
    device: spec.device,
    seq: spec.seq,
    ts: spec.ts,
    type: 'upsert',
    entity: ENTITY.pulse,
    entityId: spec.entityId,
    fields: spec.fields,
  };
}

function del(spec: { id: string; device: string; seq: number; ts: number; entityId: string }): DeleteEvent {
  return {
    id: spec.id,
    device: spec.device,
    seq: spec.seq,
    ts: spec.ts,
    type: 'delete',
    entity: ENTITY.pulse,
    entityId: spec.entityId,
  };
}

describe('the pulse fold', () => {
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

  it('an upsert creates the record, a delete tombstones it, and a later upsert resurrects only its own fields', async () => {
    const created = upsert({
      id: 'e-create',
      device: 'a',
      seq: 1,
      ts: 100,
      entityId: 'p1',
      fields: { text: 'wrote the plan', at: '2026-08-27T09:00:00.000Z' },
    });
    const removed = del({ id: 'e-delete', device: 'a', seq: 2, ts: 200, entityId: 'p1' });
    // Tied on ts with the delete: only the device tiebreak in the
    // (ts, device, seq, id) order says the resurrection is the later event.
    // A three-part order would call this a draw, and the fold's own
    // belt-and-braces guard would then decide it arbitrarily.
    const revived = upsert({
      id: 'e-revive',
      device: 'b',
      seq: 1,
      ts: 200,
      entityId: 'p1',
      fields: { at: '2026-08-27T10:00:00.000Z' },
    });

    // fold(), directly: the pure semantics being pinned for this entity.
    const afterCreate = fold([created]);
    expect(afterCreate.warnings).toEqual([]);
    expect(afterCreate.state.pulse).toEqual({ p1: { text: 'wrote the plan', at: '2026-08-27T09:00:00.000Z' } });

    const afterDelete = fold([created, removed]);
    expect(afterDelete.warnings).toEqual([]);
    expect(afterDelete.state).toEqual({});

    const afterRevive = fold([created, removed, revived]);
    expect(afterRevive.warnings).toEqual([]);
    expect(afterRevive.state.pulse).toEqual({ p1: { at: '2026-08-27T10:00:00.000Z' } });

    // The same events, through the path the app actually reads: the outbox,
    // hydrate's own call to fold (inside getPulses), and the row mapping.
    await enqueue([created]);
    expect(await getPulses()).toEqual([{ id: 'p1', text: 'wrote the plan', at: '2026-08-27T09:00:00.000Z' }]);

    await enqueue([removed]);
    resetSession();
    expect(await getPulses()).toEqual([]);

    await enqueue([revived]);
    resetSession();
    // The pre-delete text does not survive the resurrection: the row mapping
    // falls back to '' for a field nothing wrote after the tombstone, not the
    // old value.
    expect(await getPulses()).toEqual([{ id: 'p1', text: '', at: '2026-08-27T10:00:00.000Z' }]);
  });
});

describe('compareOldestFirst', () => {
  it('sorts oldest first, and breaks a tie on `at` by id, smaller first', () => {
    const older: PulseRow = { id: 'older', text: 'a', at: '2026-08-26T09:00:00.000Z' };
    const newer: PulseRow = { id: 'newer', text: 'b', at: '2026-08-26T10:00:00.000Z' };
    expect([older, newer].sort(compareOldestFirst).map((row) => row.id)).toEqual(['older', 'newer']);
    expect([newer, older].sort(compareOldestFirst).map((row) => row.id)).toEqual(['older', 'newer']);

    const aaa: PulseRow = { id: 'aaa', text: 'x', at: '2026-08-26T09:00:00.000Z' };
    const zzz: PulseRow = { id: 'zzz', text: 'y', at: '2026-08-26T09:00:00.000Z' };
    expect([aaa, zzz].sort(compareOldestFirst).map((row) => row.id)).toEqual(['aaa', 'zzz']);
    expect([zzz, aaa].sort(compareOldestFirst).map((row) => row.id)).toEqual(['aaa', 'zzz']);
  });
});

describe('pulsesForDay', () => {
  const zone = 'America/Los_Angeles';

  it('keeps a pulse whose UTC day differs from the local day it was captured on, and orders survivors oldest first', () => {
    const boundary: PulseRow = {
      id: 'boundary',
      text: 'still the 26th here',
      // 01:00 UTC on the 27th is 18:00 on the 26th in Los Angeles (UTC-7 in
      // August). Slicing the ISO string's first ten characters — the bug this
      // function exists to prevent — would file it under the 27th instead.
      at: '2026-08-27T01:00:00.000Z',
    };
    const normal: PulseRow = { id: 'normal', text: 'afternoon', at: '2026-08-26T20:00:00.000Z' };
    const dayBefore: PulseRow = { id: 'day-before', text: 'yesterday', at: '2026-08-25T12:00:00.000Z' };

    const rows = pulsesForDay([normal, dayBefore, boundary], '2026-08-26', zone);

    // dayBefore is excluded, and the two survivors come back oldest first.
    expect(rows.map((row) => row.id)).toEqual(['normal', 'boundary']);
  });

  it('breaks a tie on `at` by id, smaller id first', () => {
    const rows: PulseRow[] = [
      { id: 'aaa', text: 'first alphabetically', at: '2026-08-26T12:00:00.000Z' },
      { id: 'zzz', text: 'last alphabetically', at: '2026-08-26T12:00:00.000Z' },
    ];

    expect(pulsesForDay(rows, '2026-08-26', zone).map((row) => row.id)).toEqual(['aaa', 'zzz']);
  });

  it('drops a row whose `at` cannot be parsed as an instant, rather than throwing', () => {
    const rows: PulseRow[] = [
      { id: 'good', text: 'valid', at: '2026-08-26T12:00:00.000Z' },
      { id: 'bad', text: 'hand-edited journal line', at: 'not-a-real-instant' },
    ];

    expect(() => pulsesForDay(rows, '2026-08-26', zone)).not.toThrow();
    expect(pulsesForDay(rows, '2026-08-26', zone).map((row) => row.id)).toEqual(['good']);
  });
});

function dbReset() {
  beforeEach(() => {
    resetSession();
    codePulseMock.mockReset();
  });
  afterEach(async () => {
    resetSession();
    codePulseMock.mockReset();
    await closeDb();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('meridian');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'));
    });
  });
}

describe('enrichPulse', () => {
  dbReset();

  it("writes the coder's derived fields and nothing else — never text, never at (fence 1)", async () => {
    const created = await createPulse('wrote the plan');

    await enrichPulse(created.id, SAMPLE_CODING);

    const queued = await peekOutbox<JournalEvent & OutboxRecord>();
    const enrichment = queued.find(
      (event): event is UpsertEvent & OutboxRecord =>
        event.type === 'upsert' && event.entityId === created.id && !('text' in event.fields)
    );
    expect(enrichment).toBeDefined();
    // The whole coding, `effects` and `vocabProposal` included — those two are
    // stored, not held in memory, because a coded pulse is invisible to the
    // sweep forever and the chip UI has to be able to render them later.
    expect(enrichment?.fields).toEqual(SAMPLE_CODING);
    expect(enrichment?.fields).not.toHaveProperty('text');
    expect(enrichment?.fields).not.toHaveProperty('at');

    const rows = await getPulses();
    const row = rows.find((r) => r.id === created.id);
    expect(row?.text).toBe('wrote the plan'); // untouched
    expect(row?.signal).toBe('task');
  });

  it('stores effects and the vocab proposal so they survive the fold, not just the sweep that produced them', async () => {
    const created = await createPulse('sort out the boiler');

    await enrichPulse(created.id, SAMPLE_CODING);

    // A real re-open: the session is dropped and the state rebuilt from the
    // journal, which is the only place a proposal could have survived to.
    resetSession();

    const row = (await getPulses()).find((r) => r.id === created.id);
    expect(row?.effects).toEqual([{ type: 'spawnTask', text: 'call the plumber' }]);
    expect(row?.vocabProposal).toEqual({ kind: 'activity', value: 'plumbing', mapsTo: 'home-ops' });
  });

  it('reads a malformed proposal as absent and drops an effect it could not render, rather than throwing', async () => {
    await enqueue([
      upsert({
        id: 'e-hand-edited',
        device: 'a',
        seq: 1,
        ts: 100,
        entityId: 'p-hand-edited',
        fields: {
          text: 'from a hand-edited journal',
          at: '2026-08-28T09:00:00.000Z',
          signal: 'note',
          effects: [{ type: 'spawnTask' }, { type: 'notAnEffect' }, 'nonsense'],
          vocabProposal: { kind: 'notAKind', value: 'x', mapsTo: null },
        },
      }),
    ]);
    resetSession();

    const row = (await getPulses()).find((r) => r.id === 'p-hand-edited');
    expect(row?.effects).toEqual([{ type: 'spawnTask' }]);
    expect(row?.vocabProposal).toBeUndefined();
  });

  it('does not read back or throw when the row is not found afterward — the write still lands (L4)', async () => {
    // Simulates the race commit's generation guard allows: the row is not (or
    // no longer) in this session, but the event must still be safe and queued
    // rather than thrown away, unlike createPulse's read-back-and-throw.
    await expect(enrichPulse('never-created', SAMPLE_CODING)).resolves.toBeUndefined();

    const queued = await peekOutbox<JournalEvent & OutboxRecord>();
    expect(queued.some((event) => event.entityId === 'never-created' && event.type === 'upsert')).toBe(true);
  });

  it("an enrichment landing after a delete resurrects the pulse with text and at both falling back — pinned P2 behaviour, sharpened by fence 1's own ban on carrying `at`", async () => {
    const created = await createPulse('temporary note');
    await deletePulse(created.id);

    await enrichPulse(created.id, SAMPLE_CODING);

    const rows = await getPulses();
    const resurrected = rows.find((r) => r.id === created.id);
    // Fence 1 forbids enrichPulse from carrying `at`, so unlike the
    // hand-crafted revival in "the pulse fold" above (which deliberately
    // supplied a fresh `at`), here BOTH text and at fall back — text to '',
    // at to the epoch floor toPulseRow uses for a field nothing wrote.
    expect(resurrected).toMatchObject({ id: created.id, text: '', at: '1970-01-01T00:00:00.000Z', signal: 'task' });
  });
});

describe('ensurePulseVocabSeeded', () => {
  dbReset();

  it('seeds the Appendix A values exactly once — a second call writes nothing further', async () => {
    const before = await outboxSize();

    const first = await ensurePulseVocabSeeded();
    expect(first.domains).toEqual(['db', 'hoa', 'family', 'home-ops', 'self', 'social', 'transit', 'admin']);
    expect(first.activities).toEqual({
      gym: 'self',
      read: 'self',
      'deep-work': 'db',
      'school-run': 'family',
      dinner: 'family',
      drinks: 'social',
    });
    expect(first.people).toEqual(['wife', 'kids']);

    const afterFirst = await outboxSize();
    expect(afterFirst).toBe(before + 1);

    const second = await ensurePulseVocabSeeded();
    expect(second).toEqual(first);
    expect(await outboxSize()).toBe(afterFirst); // idempotent: no second seed event
  });

  it('resolves gym/lift/strength to the strength habit and read to the reading habit, case-insensitively', async () => {
    const strength = await createHabit({ label: 'Strength', category: 'health' });
    const reading = await createHabit({ label: 'READING', category: 'learning' });

    const vocab = await ensurePulseVocabSeeded();

    expect(vocab.habitAliases).toEqual({
      gym: strength.id,
      lift: strength.id,
      strength: strength.id,
      read: reading.id,
    });
  });

  it('omits an alias rather than guessing when no habit matches — nulls over guesses applies at seed time too', async () => {
    await createHabit({ label: 'Meditate', category: 'health' });

    const vocab = await ensurePulseVocabSeeded();

    expect(vocab.habitAliases).toEqual({});
  });
});

describe('codeUncodedPulses', () => {
  dbReset();

  /** Appendix B's allowlist, keyed by the object it governs. 'root' is the wire payload itself. */
  const ALLOWED_KEYS: Record<string, readonly string[]> = {
    root: ['text', 'now', 'tz', 'vocab', 'todayEvents', 'todayHabits', 'openTowerItems', 'recentPulses', 'mouth'],
    vocab: ['domains', 'activities', 'people', 'habitAliases'],
    todayEvents: ['id', 'title', 'calendar', 'start', 'end'],
    todayHabits: ['id', 'name', 'done'],
    openTowerItems: ['id', 'text', 'status'],
    recentPulses: ['text', 'coding'],
    coding: ['signal', 'domain', 'activity', 'people', 'span', 'links'],
    span: ['start', 'end', 'approx'],
    links: ['habitId', 'towerId', 'eventId'],
  };

  /** Only these object-shaped fields are walked further; activities/habitAliases/domains/people are opaque leaves. */
  const NESTED = new Set(['vocab', 'todayEvents', 'todayHabits', 'openTowerItems', 'recentPulses', 'coding', 'span', 'links']);

  function assertAllowed(value: unknown, allowKey: string): void {
    if (Array.isArray(value)) {
      value.forEach((item) => assertAllowed(item, allowKey));
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const allowed = ALLOWED_KEYS[allowKey];
    if (!allowed) throw new Error(`test bug: no allowlist registered for "${allowKey}"`);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      expect(allowed).toContain(key);
      if (NESTED.has(key)) assertAllowed((value as Record<string, unknown>)[key], key);
    }
  }

  it("assembles a payload that is a strict subset of Appendix B's allowlist, and nothing else (fence 5)", async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);
    const today = getToday();

    // A calendar event carrying fields the allowlist does not name.
    await putCachedContent('calendar-data', {
      path: EVENTS_PATH,
      sha: 'x',
      fetchedAt: Date.now(),
      text: JSON.stringify({
        generated_at: new Date().toISOString(),
        window: { start: today, end: today },
        calendars: ['Family'],
        events: [
          {
            id: 'ev1',
            calendar: 'Family',
            title: 'Trip',
            start: today,
            end: addDays(today, 1),
            allDay: true,
            location: 'Somewhere the allowlist never mentions',
          },
        ],
      }),
    });

    // A habit, done today — todayHabits must read `name`, not the row's `label`.
    const habit = await createHabit({ label: 'Strength', category: 'health', description: 'unlisted field' });
    await toggleCompletion(habit.id, today, true);

    // An open tower item carrying fields the allowlist does not name.
    await createTowerItem({ text: 'call the plumber', waitingOn: 'a callback', effort: 'quick' });

    // Two prior pulses (one already coded), and the target — via raw events
    // so `at` ordering is exact rather than depending on wall-clock timing.
    await enqueue([
      upsert({
        id: 'e-prior-1',
        device: 'a',
        seq: 1,
        ts: 100,
        entityId: 'p-prior-1',
        fields: { text: 'earlier', at: '2026-08-28T07:00:00.000Z' },
      }),
      upsert({
        id: 'e-prior-2',
        device: 'a',
        seq: 2,
        ts: 200,
        entityId: 'p-prior-2',
        fields: { text: 'coded earlier', at: '2026-08-28T08:00:00.000Z', ...SAMPLE_ENRICHMENT },
      }),
      upsert({
        id: 'e-target',
        device: 'a',
        seq: 3,
        ts: 300,
        entityId: 'p-target',
        fields: { text: 'the one being coded', at: '2026-08-28T09:00:00.000Z' },
      }),
    ]);
    resetSession();

    await codeUncodedPulses();

    // 'earlier' (p-prior-1) is also uncoded, so the sweep codes it too — this
    // proves the allowlist property on the pulse we actually care about.
    const calls = codePulseMock.mock.calls as Array<[string, Record<string, unknown>]>;
    const call = calls.find(([calledText]) => calledText === 'the one being coded');
    expect(call).toBeDefined();
    const [text, context] = call as [string, Record<string, unknown>];

    assertAllowed({ text, ...context }, 'root');

    // Positive checks: the right values under the right names, not merely an
    // absence of extras.
    expect(context.mouth).toBe('today');
    expect(context.todayHabits).toEqual([{ id: habit.id, name: 'Strength', done: true }]);
    expect((context.todayEvents as unknown[]).length).toBe(1);
    const recentPulses = context.recentPulses as Array<{ text: string; coding?: unknown }>;
    expect(recentPulses.map((p) => p.text)).toEqual(['earlier', 'coded earlier']);
    expect(recentPulses[0].coding).toBeUndefined(); // 'earlier' was uncoded when this context was built
    expect(recentPulses[1].coding).toEqual(SAMPLE_ENRICHMENT);
  });

  it('codes an uncoded pulse once — a second sweep after it succeeded makes no further call (P1)', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);
    const created = await createPulse('only pulse today');

    await codeUncodedPulses();
    expect(codePulseMock).toHaveBeenCalledTimes(1);

    // A real re-open, not a second call against the same live session: the
    // memoised fold is dropped and rebuilt from journalCache + outbox, which
    // is the only thing that proves the enrichment is durable rather than
    // merely present in memory.
    resetSession();

    await codeUncodedPulses();
    expect(codePulseMock).toHaveBeenCalledTimes(1); // no additional call — it is no longer uncoded

    const rows = await getPulses();
    expect(rows.find((row) => row.id === created.id)?.signal).toBe('task');
  });

  it('a coder failure leaves the pulse exactly as it was, and it is retried next sweep rather than wedged (L2, L3)', async () => {
    // Seeded ahead of time so the vocab seed's own one-time write does not
    // inflate the outbox delta this test is actually about.
    await ensurePulseVocabSeeded();
    codePulseMock.mockRejectedValueOnce(new Error('offline'));
    const created = await createPulse('will fail once');

    const before = await outboxSize();
    await codeUncodedPulses();
    expect(await outboxSize()).toBe(before); // no partial enrichment upsert queued

    let rows = await getPulses();
    let row = rows.find((r) => r.id === created.id);
    expect(row?.signal).toBeUndefined();
    expect(row?.text).toBe('will fail once'); // untouched

    // Nothing marks it "in flight" past the failed call (L3): the very next
    // sweep retries it rather than skipping it forever.
    codePulseMock.mockResolvedValueOnce(SAMPLE_CODING);
    await codeUncodedPulses();
    expect(codePulseMock).toHaveBeenCalledTimes(2);

    rows = await getPulses();
    row = rows.find((r) => r.id === created.id);
    expect(row?.signal).toBe('task');
  });

  it("a null coding — fence 2's collapsed outcome — leaves the pulse uncoded; asserts the absence of fallback logic", async () => {
    // Seeded ahead of time so the vocab seed's own one-time write does not
    // inflate the outbox delta this test is actually about.
    await ensurePulseVocabSeeded();
    codePulseMock.mockResolvedValueOnce(null);
    const created = await createPulse('unusable model output');

    const before = await outboxSize();
    await codeUncodedPulses();

    // No keyword/heuristic path exists to have produced a different result:
    // the only observable behaviour is that nothing changed.
    expect(await outboxSize()).toBe(before);
    const rows = await getPulses();
    const row = rows.find((r) => r.id === created.id);
    expect(row?.signal).toBeUndefined();
    expect(row?.text).toBe('unusable model output');
  });
});

describe("the coder's context is the pulse's own moment, not the sweep's (D1)", () => {
  dbReset();

  it('codes a pulse captured days ago against its own instant, its own local day, and that day\'s habits', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);
    const zone = deviceTimeZone();

    // Three days back, at midday UTC, and the day derived rather than assumed:
    // the assertion must hold in whatever zone the machine running it is in.
    const capturedAt = `${addDays(getToday(), -3)}T12:00:00.000Z`;
    const pulseDay = dayKey(Date.parse(capturedAt), zone);
    const sweepDay = getToday();
    expect(pulseDay).not.toBe(sweepDay);

    // One event on the pulse's day and one on the sweep's, so the assertion
    // cannot pass by there being nothing to get wrong.
    await putCachedContent('calendar-data', {
      path: EVENTS_PATH,
      sha: 'x',
      fetchedAt: Date.now(),
      text: JSON.stringify({
        generated_at: new Date().toISOString(),
        window: { start: pulseDay, end: addDays(sweepDay, 1) },
        calendars: ['Family'],
        events: [
          { id: 'then', calendar: 'Family', title: 'The day it was said', start: pulseDay, end: addDays(pulseDay, 1), allDay: true },
          { id: 'now', calendar: 'Family', title: 'The day it was coded', start: sweepDay, end: addDays(sweepDay, 1), allDay: true },
        ],
      }),
    });

    // Done on the pulse's day, not on the sweep's.
    const habit = await createHabit({ label: 'Strength', category: 'health' });
    await toggleCompletion(habit.id, pulseDay, true);

    await enqueue([
      upsert({
        id: 'e-late',
        device: 'a',
        seq: 1,
        ts: Date.parse(capturedAt),
        entityId: 'p-late',
        fields: { text: 'gym at 6', at: capturedAt },
      }),
    ]);
    resetSession();

    await codeUncodedPulses();

    const [, context] = codePulseMock.mock.calls[0] as [string, Record<string, unknown>];
    // "now" is the utterance's moment. Resolving "at 6" against the sweep's
    // clock would put a Thursday line on Saturday, silently and for good.
    expect(context.now).toBe(capturedAt);
    expect((context.todayEvents as Array<{ id: string }>).map((event) => event.id)).toEqual(['then']);
    expect(context.todayHabits).toEqual([{ id: habit.id, name: 'Strength', done: true }]);
  });
});

describe('the sweep is bounded (D4)', () => {
  dbReset();

  it('codes at most MAX_PULSES_PER_SWEEP in one sweep, and the rest on the next one', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    const overflow = 2;
    const total = MAX_PULSES_PER_SWEEP + overflow;
    await enqueue(
      Array.from({ length: total }, (_, index) =>
        upsert({
          id: `e-${index}`,
          device: 'a',
          seq: index + 1,
          ts: 1000 + index,
          entityId: `p-${index}`,
          fields: { text: `backlog ${index}`, at: new Date(1000 + index).toISOString() },
        })
      )
    );
    resetSession();

    await codeUncodedPulses();

    // A month away leaves hundreds uncoded and every one is a paid call. The
    // owner is told nothing: uncoded is calm, and the rest wait for the next
    // open.
    expect(codePulseMock).toHaveBeenCalledTimes(MAX_PULSES_PER_SWEEP);
    expect((await getPulses()).filter((row) => row.signal === undefined)).toHaveLength(overflow);

    await codeUncodedPulses();
    expect(codePulseMock).toHaveBeenCalledTimes(total);
    expect((await getPulses()).filter((row) => row.signal === undefined)).toHaveLength(0);
  });

  it('stops when the page it was opened for is gone, rather than billing on behind it', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);
    const controller = new AbortController();

    await enqueue(
      Array.from({ length: 3 }, (_, index) =>
        upsert({
          id: `e-${index}`,
          device: 'a',
          seq: index + 1,
          ts: 1000 + index,
          entityId: `p-${index}`,
          fields: { text: `backlog ${index}`, at: new Date(1000 + index).toISOString() },
        })
      )
    );
    resetSession();
    controller.abort();

    await codeUncodedPulses(controller.signal);

    expect(codePulseMock).not.toHaveBeenCalled();
  });

  it('skips a pulse whose `at` is not a readable instant rather than coding it against nothing', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);
    await enqueue([
      upsert({
        id: 'e-bad',
        device: 'a',
        seq: 1,
        ts: 100,
        entityId: 'p-bad',
        fields: { text: 'hand-edited journal line', at: 'not-a-real-instant' },
      }),
    ]);
    resetSession();

    await codeUncodedPulses();

    // It belongs to no day — `pulsesForDay` already drops it from the stream —
    // and there is no instant for "at 6" to resolve against.
    expect(codePulseMock).not.toHaveBeenCalled();
  });
});

describe('codeCapturedPulse', () => {
  dbReset();

  it('codes the line just captured and nothing else — the backlog belongs to the sweep', async () => {
    await enqueue([
      upsert({
        id: 'e-old',
        device: 'a',
        seq: 1,
        ts: 100,
        entityId: 'p-old',
        fields: { text: 'uncoded from last week', at: '2026-08-20T09:00:00.000Z' },
      }),
    ]);
    resetSession();
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    const created = await createPulse('the newest thing');
    await codeCapturedPulse(created.id);

    expect(codePulseMock).toHaveBeenCalledTimes(1);
    expect((codePulseMock.mock.calls[0] as [string, unknown])[0]).toBe('the newest thing');
    expect((await getPulses()).find((row) => row.id === 'p-old')?.signal).toBeUndefined();
  });

  it('does nothing for a pulse that is already coded', async () => {
    codePulseMock.mockResolvedValue(SAMPLE_CODING);
    const created = await createPulse('coded once');
    await codeCapturedPulse(created.id);
    expect(codePulseMock).toHaveBeenCalledTimes(1);

    await codeCapturedPulse(created.id);
    expect(codePulseMock).toHaveBeenCalledTimes(1);
  });
});

describe('habitAliases repair (D7)', () => {
  dbReset();

  it('fills in aliases the seed could not resolve, once the habits exist', async () => {
    // Seeded before any habit exists — the owner's very first coded pulse on a
    // fresh device, or an owner whose habits are not labelled the seed's way.
    const seeded = await ensurePulseVocabSeeded();
    expect(seeded.habitAliases).toEqual({});

    const strength = await createHabit({ label: 'Strength', category: 'health' });

    const repaired = await ensurePulseVocabSeeded();
    expect(repaired.habitAliases).toEqual({ gym: strength.id, lift: strength.id, strength: strength.id });

    // And it survives the fold: without this, phase 3's habit-timing histogram
    // reads an empty map forever, because the seed never runs a second time.
    resetSession();
    expect((await ensurePulseVocabSeeded()).habitAliases).toEqual({
      gym: strength.id,
      lift: strength.id,
      strength: strength.id,
    });
  });

  it('writes nothing when there is still no habit to point at — omit rather than guess', async () => {
    await createHabit({ label: 'Meditate', category: 'health' });
    await ensurePulseVocabSeeded();

    const before = await outboxSize();
    const again = await ensurePulseVocabSeeded();

    expect(again.habitAliases).toEqual({});
    expect(await outboxSize()).toBe(before);
  });

  it('never overwrites what is already there: it repairs from empty only', async () => {
    const strength = await createHabit({ label: 'Strength', category: 'health' });
    await ensurePulseVocabSeeded();

    // A habit the seed would now also map. The aliases are no longer empty, so
    // nothing is rewritten — growth past the seed is the vocabProposal chip's
    // job, not this function's.
    await createHabit({ label: 'Reading', category: 'learning' });

    const before = await outboxSize();
    const again = await ensurePulseVocabSeeded();

    expect(again.habitAliases).toEqual({ gym: strength.id, lift: strength.id, strength: strength.id });
    expect(await outboxSize()).toBe(before);
  });
});
