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
import { ENTITY, readPulseVocabRow, resetSession } from './entities';
import type { PulseEffect, PulseRow } from './entities';
import { fold } from './journal';
import type { JournalEvent } from './journal';
import { compareOldestFirst, pulsesForDay } from './pulse';
import { addDays, getToday } from '../utils/dates';
import {
  applyPulseEffect,
  approvePulseVocabProposal,
  backfillPulseCoding,
  codeCapturedPulse,
  codeUncodedPulses,
  countPulseCodingWork,
  pulsesToCode,
  createHabit,
  createPulse,
  createTowerItem,
  deletePulse,
  dismissPulseEffect,
  dismissPulseVocabProposal,
  enrichPulse,
  ensurePulseVocabSeeded,
  getPulses,
  getTowerItems,
  MAX_PULSES_PER_SWEEP,
  PULSE_EPOCH,
  pulsesToBackfill,
  toggleCompletion,
} from '../services/data';
import { CODER_REV } from '../services/coder';
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
  links: { eventId: null },
  nutrition: null,
  corrections: [],
  coderRev: CODER_REV,
  effects: [{ type: 'claimEvent', eventId: 'evt-sample' }],
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

// Frozen file-wide: `createPulse` stamps `at` from the real clock, and
// `buildCoderContext` reads `getToday()`-derived habit/calendar data
// alongside pulses whose `at` is hardcoded to 2026-08-28 (see "fence 5"
// below) — both must land on the same calendar day, which the wall clock
// cannot promise once it crosses local midnight mid-run. Noon UTC sits
// safely inside 2026-08-28 in every real timezone.
const NOW = new Date('2026-08-28T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

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
    // The fold above still resurrects `p1` — that is the journal's contract for
    // every entity and the assertions on `afterRevive` pin it. The row reader
    // is where it stops: the resurrection carries no `text`, so on this replica
    // there is no pulse to read, only an orphan the journal remembers.
    expect(await getPulses()).toEqual([]);
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

  it('folds a pre-phase-4 links object by reading past the two retired keys', async () => {
    // A line written by a build that still had `completeHabit`/`spawnTask`, in
    // a journal that is never compacted and never migrated. It must fold
    // silently: `habitId` and `towerId` are read past, `eventId` still lands.
    await enqueue([
      upsert({
        id: 'e-legacy-links',
        device: 'a',
        seq: 1,
        ts: 100,
        entityId: 'p-legacy',
        fields: {
          text: 'that was the school thing',
          at: '2026-08-28T09:00:00.000Z',
          signal: 'claim',
          links: { habitId: 'h-old', towerId: 't-old', eventId: 'evt-1' },
        },
      }),
    ]);
    resetSession();

    const row = (await getPulses()).find((r) => r.id === 'p-legacy');
    expect(row?.links).toEqual({ eventId: 'evt-1' });
    expect(row?.signal).toBe('claim');
  });

  it('stores effects and the vocab proposal so they survive the fold, not just the sweep that produced them', async () => {
    const created = await createPulse('sort out the boiler');

    await enrichPulse(created.id, SAMPLE_CODING);

    // A real re-open: the session is dropped and the state rebuilt from the
    // journal, which is the only place a proposal could have survived to.
    resetSession();

    const row = (await getPulses()).find((r) => r.id === created.id);
    expect(row?.effects).toEqual([{ type: 'claimEvent', eventId: 'evt-sample' }]);
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
          // `spawnTask` is a phase-4 retirement rather than nonsense, and it
          // drops the same way: a journal line written by an older build is
          // read past, never migrated.
          effects: [{ type: 'claimEvent' }, { type: 'spawnTask' }, { type: 'notAnEffect' }, 'nonsense'],
          vocabProposal: { kind: 'notAKind', value: 'x', mapsTo: null },
        },
      }),
    ]);
    resetSession();

    const row = (await getPulses()).find((r) => r.id === 'p-hand-edited');
    expect(row?.effects).toEqual([{ type: 'claimEvent' }]);
    expect(row?.vocabProposal).toBeUndefined();
  });

  it('writes nothing, and does not throw, when the row is not in this session (L4)', async () => {
    // L4 used to pin the opposite: queue the event anyway, because a row absent
    // from this session may still exist remotely (a `resetSession()` landing
    // mid-call), and an event is safe where a throw loses the coding.
    //
    // The delete guard reverses it, because the two cases are indistinguishable
    // from here — absent is absent. Skipping costs a coder round trip, since an
    // uncoded pulse stays visible to the sweep and is picked up again. Writing
    // blind costs a resurrected ghost the reader must then filter forever. The
    // recoverable failure wins. Still resolves rather than throwing, unlike
    // createPulse's read-back-and-throw.
    await expect(enrichPulse('never-created', SAMPLE_CODING)).resolves.toBeUndefined();

    const queued = await peekOutbox<JournalEvent & OutboxRecord>();
    expect(queued.some((event) => event.entityId === 'never-created')).toBe(false);
  });

  it('an enrichment landing after a delete does not bring the pulse back — a folded row with no text was never captured here', async () => {
    const created = await createPulse('temporary note');
    await deletePulse(created.id);

    await enrichPulse(created.id, SAMPLE_CODING);

    // Was pinned the other way (P2): the enrichment resurrected the row and it
    // read back with text '' and an epoch `at`. The ledger is what reversed it
    // — a ghost with nutrition kept counting kcal for a deleted meal, and a
    // ghost correction stood at the epoch floor, outranking every real one.
    const rows = await getPulses();
    expect(rows.some((r) => r.id === created.id)).toBe(false);
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
      // Phase 5's one addition. Nutrition extraction is NOT gated on it —
      // the label is for the ledger's rows.
      eating: 'self',
    });
    expect(first.people).toEqual(['wife', 'kids']);

    const afterFirst = await outboxSize();
    expect(afterFirst).toBe(before + 1);

    const second = await ensurePulseVocabSeeded();
    expect(second).toEqual(first);
    expect(await outboxSize()).toBe(afterFirst); // idempotent: no second seed event
  });

  it("seeds no habit aliases at all — habits are not the coder's to know (fence 9)", async () => {
    await createHabit({ label: 'Strength', category: 'health' });
    await createHabit({ label: 'READING', category: 'learning' });

    const vocab = await ensurePulseVocabSeeded();

    // Phase 4 removed `habitAliases` from the type and the seed. The field is
    // asserted absent rather than empty: a seed writing `{}` would still be
    // telling every device that habits are part of the vocabulary.
    expect('habitAliases' in vocab).toBe(false);
  });

});

describe('codeUncodedPulses', () => {
  dbReset();

  /** Appendix B's allowlist, keyed by the object it governs. 'root' is the wire payload itself. */
  const ALLOWED_KEYS: Record<string, readonly string[]> = {
    root: ['text', 'now', 'tz', 'vocab', 'todayEvents', 'recentPulses'],
    vocab: ['domains', 'activities', 'people'],
    todayEvents: ['id', 'title', 'calendar', 'start', 'end'],
    recentPulses: ['text', 'coding'],
    coding: ['signal', 'domain', 'activity', 'people', 'span', 'links'],
    span: ['start', 'end', 'approx'],
    links: ['eventId'],
  };

  /** Only these object-shaped fields are walked further; activities/domains/people are opaque leaves. */
  const NESTED = new Set(['vocab', 'todayEvents', 'recentPulses', 'coding', 'span', 'links']);

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
    // Fence 9, asserted where it can actually be checked: the habit and the
    // tower item created above exist and are done/open, and neither reaches
    // the wire under any name. `assertAllowed` proves no extra key; these
    // prove the slices themselves are gone rather than merely renamed.
    expect(context.todayHabits).toBeUndefined();
    expect(context.openTowerItems).toBeUndefined();
    expect(context.mouth).toBeUndefined();
    expect(JSON.stringify(context)).not.toContain(habit.id);
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

// ============================================================================
// The snapshot a sweep walks goes stale under it (D8)
// ============================================================================

describe('a pulse coded while the sweep was blocked on an earlier one', () => {
  dbReset();

  /**
   * The race, made deterministic.
   *
   * `codeUncodedPulses` reads the rows once and walks that snapshot. Blocked
   * inside the first pulse's call — which is the normal case, a coder call is
   * the slowest thing in the app — the capture trigger codes the SECOND pulse
   * to completion beside it. The sweep then resumes into a snapshot where that
   * pulse is still uncoded and its in-flight marker has already been released.
   *
   * Nothing here is contrived: the two triggers are `usePulses`'s own, one on
   * open and one on save, and the plan gives them both.
   */
  async function sweepOvertakenByACapture(): Promise<{ first: string; second: string }> {
    const first = 'the line the sweep blocks on';
    const second = 'the line coded while it waits';
    await createPulse(first);
    const captured = await createPulse(second);

    // The sweep walks them in this order; the whole race depends on it, so it
    // is asserted rather than assumed.
    expect((await getPulses()).map((row) => row.text)).toEqual([first, second]);

    let enteredFirst = () => {};
    const entered = new Promise<void>((resolve) => {
      enteredFirst = resolve;
    });
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    codePulseMock.mockImplementation(async (text: string) => {
      if (text === first) {
        enteredFirst();
        await blocked;
      }
      return codingWith([{ type: 'claimEvent', eventId: `evt for ${text}` }]);
    });

    const sweep = codeUncodedPulses();
    await entered;
    await codeCapturedPulse(captured.id);
    release();
    await sweep;

    return { first, second };
  }

  it('is not coded a second time when the sweep reaches it — the row is re-read, not the snapshot', async () => {
    const { second } = await sweepOvertakenByACapture();

    const codedSecond = (codePulseMock.mock.calls as Array<[string, unknown]>).filter(
      ([text]) => text === second
    );
    // Twice is a second paid call, a second set of proposals over the first,
    // and a coding of a line that was already read.
    expect(codedSecond).toHaveLength(1);
  });

});

// ============================================================================
// Chips: applying a proposal, and dropping one
// ============================================================================

/**
 * A coding carrying exactly the effects given, and nothing else proposed.
 * Enrichment is the only way an effect ever reaches a row, so every test here
 * writes one rather than hand-assembling a journal line.
 */
function codingWith(effects: Coding['effects'], vocabProposal: Coding['vocabProposal'] = null): Coding {
  return { ...SAMPLE_CODING, effects, vocabProposal };
}

/** The pulse row as the store answers for it now. */
async function reread(id: string): Promise<PulseRow> {
  const row = (await getPulses()).find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`pulse ${id} is gone`);
  return row;
}

/**
 * Tap the chip sitting at `index`: the position is read off the ROW, and what
 * goes into the data layer is the effect itself.
 *
 * That is exactly what both views do, and `applyPulseEffect` takes nothing
 * else — a position cannot survive a tap, because an apply rewrites the list
 * every later chip's position is measured against. Reading the stored effect
 * rather than passing back the literal the test wrote also keeps `effectKey`
 * honest: it is structural equality over the stored JSON, and both sides come
 * out of the same line.
 */
async function chipAt(pulseId: string, index: number): Promise<PulseEffect> {
  const effects = (await reread(pulseId)).effects ?? [];
  expect(effects.length).toBeGreaterThan(index);
  return effects[index];
}

async function applyChip(pulseId: string, index = 0): Promise<void> {
  return applyPulseEffect(pulseId, await chipAt(pulseId, index));
}

async function dismissChip(pulseId: string, index = 0): Promise<void> {
  return dismissPulseEffect(pulseId, await chipAt(pulseId, index));
}

/**
 * Run `work` with `Date.now()` moving a second every time it is read.
 *
 * This is what makes "one commit" observable from the outbox alone. `commit`
 * reads the clock exactly ONCE per call and stamps that `ts` on every draft it
 * carries (`entities.ts`'s `record`), so under a ticking clock the events of a
 * single commit share a `ts` and the events of two commits cannot — no matter
 * how close together the two calls sit. Without it the file-wide frozen clock
 * gives every write the same `ts` and the assertion proves nothing.
 *
 * Nothing else on an apply's path reads `Date.now()`: the field timestamps go
 * through `nowIso`, which is `new Date()`, still answered by the frozen clock.
 */
async function withTickingClock(work: () => Promise<void>): Promise<void> {
  let tick = NOW.getTime();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => (tick += 1000));
  try {
    await work();
  } finally {
    clock.mockRestore();
  }
}

/**
 * The two events an apply is required to have written TOGETHER.
 *
 * The pair that came out of one commit is: the last two events in the outbox
 * (`peekOutbox` reads the `bySeq` index, ascending), on consecutive seqs, from
 * one device, sharing one `ts` — see `withTickingClock`, which the apply must
 * have run under for that last part to mean anything.
 *
 * Read off the outbox, which is what was actually durably queued, rather than
 * off a spy on `commit`'s arguments, which would prove only that the caller
 * asked nicely.
 */
async function assertOneCommit(entity: string, pulseId: string): Promise<void> {
  const queued = await peekOutbox<JournalEvent & OutboxRecord>();
  expect(queued.length).toBeGreaterThanOrEqual(2);
  const [target, listUpdate] = queued.slice(-2);

  expect(target.entity).toBe(entity);
  expect(listUpdate.entity).toBe(ENTITY.pulse);
  expect(listUpdate.entityId).toBe(pulseId);
  expect(listUpdate.type).toBe('upsert');
  const fields = (listUpdate as UpsertEvent).fields;
  expect('effects' in fields || 'vocabProposal' in fields).toBe(true);

  expect(target.ts).toBe(listUpdate.ts);
  expect(target.device).toBe(listUpdate.device);
  expect(listUpdate.seq - target.seq).toBe(1);
}

describe('applying an effect chip', () => {
  dbReset();

  it('claimEvent sets links.eventId and nothing else — a claim has no entity of its own', async () => {
    const pulse = await createPulse('that was the school thing');
    await enrichPulse(pulse.id, codingWith([{ type: 'claimEvent', eventId: 'evt-42' }]));

    await applyChip(pulse.id, 0);

    const row = await reread(pulse.id);
    expect(row.links?.eventId).toBe('evt-42');
    expect(row.effects).toEqual([]);
  });

  it('applies only the effect tapped, leaving the rest of the chips alone', async () => {
    const pulse = await createPulse('the school thing, and the other one');
    await enrichPulse(
      pulse.id,
      codingWith([{ type: 'claimEvent', eventId: 'evt-1' }, { type: 'claimEvent', eventId: 'evt-2' }])
    );

    await applyChip(pulse.id, 1);

    const row = await reread(pulse.id);
    expect(row.effects).toEqual([{ type: 'claimEvent', eventId: 'evt-1' }]);
    expect(row.links?.eventId).toBe('evt-2');
  });

  it('writes nothing at all for an effect the pulse does not hold', async () => {
    const pulse = await createPulse('nothing proposed here');
    await enrichPulse(pulse.id, codingWith([]));
    const before = await outboxSize();

    // The state a second tap on a chip the repaint has not cleared arrives in:
    // the proposal is gone, and the only honest answer is to write nothing.
    await applyPulseEffect(pulse.id, { type: 'claimEvent', eventId: 'never-proposed' });

    expect(await outboxSize()).toBe(before);
  });

  it('two chips tapped at once each keep their own write (F2)', async () => {
    const pulse = await createPulse('the school thing, and drinks after');
    await enrichPulse(
      pulse.id,
      codingWith([
        { type: 'claimEvent', eventId: 'evt-1' },
        { type: 'claimEvent', eventId: 'evt-2' },
      ])
    );

    // Two taps, neither waiting for the other — which is exactly what the view
    // does: `act()` fires each on its own chain.
    await Promise.all([applyChip(pulse.id, 0), applyChip(pulse.id, 1)]);

    const row = await reread(pulse.id);
    // Both are whole-field writes on one row. Interleaved, the second is built
    // from a row read before the first landed and simply overwrites it: an
    // effects list still holding a chip that was tapped, which phase 3's
    // Needed-vs-Spent reads as an event that was never claimed.
    expect(row.links?.eventId).toBe('evt-2');
    expect(row.effects).toEqual([]);
  });

  it('a second coding cannot unset a link a chip already recorded (F1b)', async () => {
    const pulse = await createPulse('that was the school thing');
    await enrichPulse(pulse.id, codingWith([{ type: 'claimEvent', eventId: 'evt-1' }]));
    await applyChip(pulse.id, 0);
    expect((await reread(pulse.id)).links?.eventId).toBe('evt-1');

    // The other device coded the same pulse before this one's enrichment
    // reached it: the same proposal again, and a null link. An apply records a
    // fact; an enrichment only proposes, so the fact outranks it.
    await enrichPulse(pulse.id, {
      ...codingWith([{ type: 'claimEvent', eventId: 'evt-1' }]),
      links: { eventId: null },
    });

    expect((await reread(pulse.id)).links?.eventId).toBe('evt-1');
  });
});

describe('dismissing a chip', () => {
  dbReset();

  it('drops the effect and keeps the coding (Appendix C)', async () => {
    const pulse = await createPulse('sort out the boiler');
    await enrichPulse(
      pulse.id,
      codingWith([{ type: 'claimEvent', eventId: 'evt-0' }, { type: 'claimEvent', eventId: 'evt-1' }])
    );

    await dismissChip(pulse.id, 0);

    // A real re-open: the dismissal has to be durable, not a render-time flag.
    resetSession();
    const row = await reread(pulse.id);
    expect(row.effects).toEqual([{ type: 'claimEvent', eventId: 'evt-1' }]);
    expect(row.signal).toBe(SAMPLE_CODING.signal);
    expect(row.domain).toBe(SAMPLE_CODING.domain);
    expect(row.span).toEqual(SAMPLE_CODING.span);
    // Nothing was created by the dismissal.
    expect(await getTowerItems(true)).toHaveLength(0);
  });

  it('drops the vocabulary proposal and keeps the coding', async () => {
    const pulse = await createPulse('plumbing all afternoon');
    await enrichPulse(pulse.id, codingWith([], { kind: 'activity', value: 'plumbing', mapsTo: 'home-ops' }));

    await dismissPulseVocabProposal(pulse.id);

    resetSession();
    const row = await reread(pulse.id);
    expect(row.vocabProposal).toBeNull();
    expect(row.signal).toBe(SAMPLE_CODING.signal);
    expect(readPulseVocabRow()?.activities.plumbing).toBeUndefined();
  });
});

describe('approving a vocabulary proposal', () => {
  dbReset();

  it('upserts pulseVocab and clears the proposal in one commit', async () => {
    const pulse = await createPulse('plumbing all afternoon');
    await enrichPulse(pulse.id, codingWith([], { kind: 'activity', value: 'plumbing', mapsTo: 'home-ops' }));

    await withTickingClock(() => approvePulseVocabProposal(pulse.id));

    expect(readPulseVocabRow()?.activities.plumbing).toBe('home-ops');
    expect((await reread(pulse.id)).vocabProposal).toBeNull();
    await assertOneCommit(ENTITY.pulseVocab, pulse.id);
  });

  it('adds a domain and a person without disturbing what is already there', async () => {
    const seeded = await ensurePulseVocabSeeded();
    const pulse = await createPulse('drinks with sam');
    await enrichPulse(pulse.id, codingWith([], { kind: 'person', value: 'sam', mapsTo: null }));

    await approvePulseVocabProposal(pulse.id);

    const vocab = readPulseVocabRow();
    expect(vocab?.people).toEqual([...seeded.people, 'sam']);
    expect(vocab?.domains).toEqual(seeded.domains);
  });

  it('approving the same value twice cannot duplicate it', async () => {
    const first = await createPulse('a new domain');
    await enrichPulse(first.id, codingWith([], { kind: 'domain', value: 'garden', mapsTo: null }));
    await approvePulseVocabProposal(first.id);

    const second = await createPulse('the same domain again');
    await enrichPulse(second.id, codingWith([], { kind: 'domain', value: 'garden', mapsTo: null }));
    await approvePulseVocabProposal(second.id);

    expect(readPulseVocabRow()?.domains.filter((domain) => domain === 'garden')).toEqual(['garden']);
    expect((await reread(second.id)).vocabProposal).toBeNull();
  });

  it('an activity with no domain to map to writes nothing', async () => {
    const pulse = await createPulse('plumbing all afternoon');
    await enrichPulse(pulse.id, codingWith([], { kind: 'activity', value: 'plumbing', mapsTo: null }));

    await approvePulseVocabProposal(pulse.id);

    expect(readPulseVocabRow()?.activities.plumbing).toBeUndefined();
    expect((await reread(pulse.id)).vocabProposal).toBeNull();
  });
});

describe('effects apply themselves', () => {
  dbReset();

  const CLAIM = { type: 'claimEvent' as const, eventId: 'evt-1' };

  it('applies as the coding lands, with no tap and no switch to find', async () => {
    // There used to be a per-type switch, defaulting off, explained in Settings
    // as "a coding proposes; you tap". The owner's verdict on it was "never
    // able to understand or use", and phase 4 had already retired every effect
    // but this one — so the copy described a general system that no longer
    // existed. The switch is gone; the one effect left simply applies.
    await createPulse('that was the school thing');
    codePulseMock.mockResolvedValue(codingWith([CLAIM]));

    await codeUncodedPulses();

    const row = (await getPulses())[0];
    expect(row.effects).toEqual([]);
    expect(row.links?.eventId).toBe('evt-1');
  });

  it('applies every effect a coding carries, not just the first', async () => {
    await createPulse('a busy line');
    codePulseMock.mockResolvedValue(codingWith([CLAIM, { type: 'claimEvent', eventId: 'evt-2' }]));

    await codeUncodedPulses();

    const row = (await getPulses())[0];
    expect(row.effects).toEqual([]);
    // Last writer wins on the one field both effects target.
    expect(row.links?.eventId).toBe('evt-2');
  });

  it('never applies a vocabulary proposal — Appendix C gives it no auto path at all', async () => {
    await createPulse('plumbing all afternoon');
    codePulseMock.mockResolvedValue(codingWith([], { kind: 'activity', value: 'plumbing', mapsTo: 'home-ops' }));

    await codeUncodedPulses();

    expect((await getPulses())[0].vocabProposal).toEqual({ kind: 'activity', value: 'plumbing', mapsTo: 'home-ops' });
    expect(readPulseVocabRow()?.activities.plumbing).toBeUndefined();
  });
});

// ============================================================================
// One parser, two mouths — Tower's box
// ============================================================================

/**
 * The backfill: the one path that re-codes an already-coded pulse, and the
 * only place `coderRev` is ever read.
 *
 * Two failure shapes are what these pin, and both are expensive rather than
 * merely wrong. A run that is not idempotent bills the whole history again on
 * every press. And a rev bound that leaked into the AMBIENT sweep would bill
 * the whole history on every open of the app, silently, forever — which is
 * why the last test here is a regression test and not a feature test.
 */
describe('pulsesToBackfill', () => {
  const epochMs = Date.parse(PULSE_EPOCH);

  function row(id: string, at: string, coderRev?: number): PulseRow {
    const base: PulseRow = { id, text: id, at, signal: 'note' };
    return coderRev === undefined ? base : { ...base, coderRev };
  }

  it('selects a coded pulse behind the current rev, and skips both a current one and an uncoded one', () => {
    const at = new Date(epochMs + 86_400_000).toISOString();
    const rows = [
      row('old-rev', at, 1),
      // Coded, but by a build that stamped no rev at all — still behind.
      row('no-rev', at),
      row('current', at, CODER_REV),
      // Uncoded, so it has no rev either. It used to land here for exactly
      // that reason, and the day a revision shipped that made the number
      // meaningless: eighteen already-coded pulses drowned the one the owner
      // was actually asking about. It is `pulsesToCode`'s now, and the two
      // sets are disjoint.
      { id: 'uncoded', text: 'uncoded', at },
    ];

    expect(pulsesToBackfill(rows).map(target => target.id)).toEqual(['old-rev', 'no-rev']);
    expect(pulsesToCode(rows).map(target => target.id)).toEqual(['uncoded']);
  });

  it('skips anything older than PULSE_EPOCH, so a restored journal cannot turn one tap into an unbounded bill', () => {
    const before = new Date(epochMs - 1).toISOString();
    const after = new Date(epochMs + 1).toISOString();
    expect(pulsesToBackfill([row('ancient', before), row('mine', after)]).map(r => r.id)).toEqual(['mine']);
  });

  it('skips a row whose `at` is not a readable instant — there is no moment to code it against', () => {
    expect(pulsesToBackfill([row('broken', 'not-a-date')])).toEqual([]);
  });

  it('returns NEWEST first, so what the owner can see is fixed first', () => {
    // Reversed when the catch-up stopped being a button and became automatic.
    // Oldest-first made sense while the owner pressed and watched. Running by
    // itself a few per foreground, the order decides when anything visibly
    // changes — and measured: rev 4 fixed a Saturday dinner, the catch-up spent
    // its first passes on pulses from days earlier, and the owner reloaded over
    // and over and reported "nothing is changing".
    const first = new Date(epochMs + 1000).toISOString();
    const second = new Date(epochMs + 2000).toISOString();
    expect(pulsesToBackfill([row('a', first), row('b', second)]).map(r => r.id)).toEqual(['b', 'a']);
  });
});

describe('backfillPulseCoding', () => {
  dbReset();

  /** A pulse coded by an older build: the coding landed, `coderRev` did not. */
  async function codedAtOldRev(text: string): Promise<PulseRow> {
    const created = await createPulse(text);
    await enrichPulse(created.id, { ...SAMPLE_CODING, coderRev: 1 });
    return created;
  }

  const WITH_FOOD: Coding = {
    ...SAMPLE_CODING,
    nutrition: { kcal: 620, kcalSource: 'stated' },
    effects: [{ type: 'claimEvent', eventId: 'evt-from-backfill' }],
    vocabProposal: { kind: 'person', value: 'barista', mapsTo: null },
  };

  it('re-codes a pulse below the current rev and writes the fields it was missing', async () => {
    const created = await codedAtOldRev('620 kcal burrito');
    codePulseMock.mockResolvedValue(WITH_FOOD);

    expect(await backfillPulseCoding('staleRev')).toEqual({ done: 1, failed: 0, total: 1 });

    // Read back through a real re-open, not the live session: what matters is
    // that the enrichment is durable, not that it is in memory.
    resetSession();
    const row = (await getPulses()).find(candidate => candidate.id === created.id);
    expect(row?.nutrition).toEqual({ kcal: 620, kcalSource: 'stated' });
    expect(row?.coderRev).toBe(CODER_REV);
  });

  it('writes coding only — never the text (fence 1), and no chips about last Tuesday', async () => {
    const created = await codedAtOldRev('620 kcal burrito');
    // A proposal already sitting under the line, unanswered, before the run.
    const before = (await getPulses()).find(candidate => candidate.id === created.id);
    expect(before?.vocabProposal).toEqual(SAMPLE_CODING.vocabProposal);

    codePulseMock.mockResolvedValue(WITH_FOOD);
    await backfillPulseCoding('staleRev');

    resetSession();
    const row = (await getPulses()).find(candidate => candidate.id === created.id);
    // The verbatim line, untouched.
    expect(row?.text).toBe('620 kcal burrito');
    // Nothing the backfill's own output proposed reached the row: no new chip
    // about a Tuesday two weeks gone.
    expect(row?.effects).toEqual(SAMPLE_CODING.effects);
    expect(row?.vocabProposal).toEqual(SAMPLE_CODING.vocabProposal);
    // And the one that was already there survived. Writing `[]`/`null` would
    // have cleared the owner's inbox as a side effect of a re-code.
    expect(row?.effects?.some(effect => effect.eventId === 'evt-from-backfill')).toBe(false);
  });

  it('is idempotent: a rerun after a clean run makes no further call and costs nothing', async () => {
    await codedAtOldRev('620 kcal burrito');
    codePulseMock.mockResolvedValue(WITH_FOOD);

    await backfillPulseCoding('staleRev');
    expect(codePulseMock).toHaveBeenCalledTimes(1);

    resetSession();
    expect(await backfillPulseCoding('staleRev')).toEqual({ done: 0, failed: 0, total: 0 });
    expect(codePulseMock).toHaveBeenCalledTimes(1);
    expect((await countPulseCodingWork()).staleRev.count).toBe(0);
  });

  it('isolates a per-pulse failure: the rest land, the failure is counted, and a rerun picks up only it', async () => {
    const doomed = await codedAtOldRev('will fail once');
    // A second apart, so the two have different instants. The clock is frozen
    // file-wide, and two pulses sharing an `at` are ordered by id — which
    // would decide which of these is attempted first by how a UUID happened
    // to come out.
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    const fine = await codedAtOldRev('will succeed');

    // Newest first, so `fine` (captured a second later) is attempted first and
    // `doomed` takes the one rejection.
    codePulseMock.mockResolvedValueOnce(WITH_FOOD);
    codePulseMock.mockRejectedValueOnce(new Error('offline'));
    codePulseMock.mockResolvedValue(WITH_FOOD);

    expect(await backfillPulseCoding('staleRev')).toEqual({ done: 1, failed: 1, total: 2 });

    resetSession();
    let rows = await getPulses();
    // The failure kept its old rev — which is the whole retry story.
    expect(rows.find(row => row.id === doomed.id)?.coderRev).toBe(1);
    expect(rows.find(row => row.id === fine.id)?.coderRev).toBe(CODER_REV);

    // "run again" does exactly that, and only for what is still behind.
    expect(await backfillPulseCoding('staleRev')).toEqual({ done: 1, failed: 0, total: 1 });
    resetSession();
    rows = await getPulses();
    expect(rows.find(row => row.id === doomed.id)?.coderRev).toBe(CODER_REV);
  });

  it('counts a null coding as a failure rather than marking the pulse current (fence 2)', async () => {
    const created = await codedAtOldRev('unusable model output');
    codePulseMock.mockResolvedValue(null);

    expect(await backfillPulseCoding('staleRev')).toEqual({ done: 0, failed: 1, total: 1 });

    resetSession();
    // Not stamped. A pulse the coder could not answer for must stay findable.
    expect((await getPulses()).find(row => row.id === created.id)?.coderRev).toBe(1);
  });

  it('reports progress after every pulse, success or not, so a failing run still moves', async () => {
    await codedAtOldRev('one');
    await codedAtOldRev('two');
    codePulseMock.mockRejectedValueOnce(new Error('offline'));
    codePulseMock.mockResolvedValue(WITH_FOOD);

    const seen: string[] = [];
    await backfillPulseCoding('staleRev', progress => seen.push(`${progress.done}/${progress.failed}/${progress.total}`));

    expect(seen).toEqual(['0/1/2', '1/1/2']);
  });

  it('stops between pulses when the owner presses stop, leaving the rest for a rerun', async () => {
    await codedAtOldRev('one');
    await codedAtOldRev('two');
    codePulseMock.mockResolvedValue(WITH_FOOD);

    const controller = new AbortController();
    const progress = await backfillPulseCoding('staleRev', () => controller.abort(), controller.signal);

    // The first was paid for and stored; the second was never started.
    expect(progress).toEqual({ done: 1, failed: 0, total: 2 });
    expect(codePulseMock).toHaveBeenCalledTimes(1);
  });

  it('quotes a cost that scales with the work, so the confirmation is about the bill', async () => {
    await codedAtOldRev('one');
    await codedAtOldRev('two');

    const scope = (await countPulseCodingWork()).staleRev;
    expect(scope.count).toBe(2);
    expect(scope.approxCostUsd).toBeGreaterThan(0);
  });
});

/**
 * The two piles are disjoint, and the one the owner asks about is the backlog.
 *
 * They used to be one number. Measured on the real journal the day this
 * changed: one pulse was genuinely uncoded and eighteen were coded at rev 2,
 * and the owner asking "did my dinner get processed?" was shown 19.
 */
describe('countPulseCodingWork splits never-coded from behind-a-revision', () => {
  dbReset();

  it('counts an uncoded pulse in `uncoded` only, and one behind a rev in `staleRev` only', async () => {
    const never = await createPulse('never coded');
    const behind = await createPulse('coded by an older build');
    await enrichPulse(behind.id, { ...SAMPLE_CODING, coderRev: 1 });

    const work = await countPulseCodingWork();
    expect(work.uncoded.count).toBe(1);
    expect(work.staleRev.count).toBe(1);

    const rows = await getPulses();
    expect(pulsesToCode(rows).map(row => row.id)).toEqual([never.id]);
    expect(pulsesToBackfill(rows).map(row => row.id)).toEqual([behind.id]);
  });

  it('leaves a current pulse out of both, so a quiet journal reads as no work owed', async () => {
    const created = await createPulse('coded at the current rev');
    await enrichPulse(created.id, SAMPLE_CODING);

    const work = await countPulseCodingWork();
    expect(work.uncoded.count).toBe(0);
    expect(work.staleRev.count).toBe(0);
    expect(work.uncoded.approxCostUsd).toBe(0);
  });

  it("codes the backlog when asked, without touching a pulse that is merely behind a revision", async () => {
    const never = await createPulse('never coded');
    const behind = await createPulse('coded by an older build');
    await enrichPulse(behind.id, { ...SAMPLE_CODING, coderRev: 1 });
    codePulseMock.mockClear();
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    expect(await backfillPulseCoding('uncoded')).toEqual({ done: 1, failed: 0, total: 1 });
    expect(codePulseMock).toHaveBeenCalledTimes(1);

    resetSession();
    const rows = await getPulses();
    expect(rows.find(row => row.id === never.id)?.signal).toBe(SAMPLE_CODING.signal);
    // Untouched, and still the other button's business.
    expect(rows.find(row => row.id === behind.id)?.coderRev).toBe(1);
  });
});

/**
 * The regression this phase is most likely to reintroduce, pinned as its own
 * test because it is a BILLING bug and not a correctness one: it would look
 * completely fine on screen.
 */
describe('a rev catch-up happens ONCE, never on every open', () => {
  dbReset();

  it('re-codes a pulse behind the rev on the first open, and never again', async () => {
    const created = await createPulse('coded by an older build');
    await enrichPulse(created.id, { ...SAMPLE_CODING, coderRev: 1 });
    codePulseMock.mockClear();
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    // Open one: the catch-up runs, because this device has never been marked
    // as current. The owner is not asked, and there is no button — a rev bump
    // can mean a STORED coding is actively wrong (rev 4 fixed meals placed at
    // the wrong hour, which silently drop out of a day's total), and a fix the
    // owner has to notice and go press is a fix that does not land.
    resetSession();
    await codeUncodedPulses();
    expect(codePulseMock).toHaveBeenCalledTimes(1);
    expect((await getPulses())[0].coderRev).toBe(CODER_REV);

    // Opens two through five: nothing. THIS is the fence. Re-coding on every
    // open is a billing bug that looks perfect on screen, and the mark in
    // `meta` — written only after a pass finds nothing left — is what makes
    // the catch-up a one-off rather than a subscription.
    for (let open = 0; open < 4; open += 1) {
      resetSession();
      await codeUncodedPulses();
    }
    expect(codePulseMock).toHaveBeenCalledTimes(1);

    // The on-save path never learned about the rev at all, and must not.
    await codeCapturedPulse(created.id);
    expect(codePulseMock).toHaveBeenCalledTimes(1);
  });

  it('costs nothing at all on a device already at the current rev', async () => {
    const created = await createPulse('already current');
    await enrichPulse(created.id, SAMPLE_CODING);
    codePulseMock.mockClear();
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    // The first open finds nothing behind, marks the device, and bills nothing.
    // Every later open short-circuits on the mark before it even reads a row.
    for (let open = 0; open < 3; open += 1) {
      resetSession();
      await codeUncodedPulses();
    }
    expect(codePulseMock).not.toHaveBeenCalled();
  });

  it('resumes rather than marking itself done when a pulse fails to re-code', async () => {
    const created = await createPulse('will fail once');
    await enrichPulse(created.id, { ...SAMPLE_CODING, coderRev: 1 });
    codePulseMock.mockClear();
    codePulseMock.mockRejectedValueOnce(new Error('offline'));
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    resetSession();
    await codeUncodedPulses();
    // Still behind: a failure keeps the old rev, and the mark was not written.
    expect((await getPulses())[0].coderRev).toBe(1);

    resetSession();
    await codeUncodedPulses();
    expect((await getPulses())[0].coderRev).toBe(CODER_REV);
  });
});

/**
 * The rev bump to 3, and what it must NOT change.
 *
 * A bump is a bill: it makes every pulse coded at the older rev eligible for
 * the backfill. That is correct and harmless because the backfill is
 * owner-invoked and priced before it runs — and it is only harmless while the
 * ambient sweep continues to ignore the rev entirely, which is what this pins
 * a second time, at the new rev.
 */
describe('CODER_REV 3', () => {
  dbReset();

  it('makes a rev-2 pulse eligible for the owner-invoked backfill', () => {
    const at = new Date(Date.parse(PULSE_EPOCH) + 86_400_000).toISOString();
    const rows: PulseRow[] = [
      { id: 'rev2', text: 'coded before corrections existed', at, signal: 'note', coderRev: 2 },
      { id: 'rev3', text: 'current', at, signal: 'note', coderRev: CODER_REV },
    ];
    expect(pulsesToBackfill(rows).map(row => row.id)).toEqual(['rev2']);
  });

  it('catches an older-rev pulse up once, then leaves it alone across further opens', async () => {
    const created = await createPulse('coded at rev 2');
    await enrichPulse(created.id, { ...SAMPLE_CODING, coderRev: 2 });
    codePulseMock.mockClear();
    codePulseMock.mockResolvedValue(SAMPLE_CODING);

    for (let open = 0; open < 3; open += 1) {
      resetSession();
      await codeUncodedPulses();
    }
    await codeCapturedPulse(created.id);

    // Once, not three times, and not once per open forever.
    expect(codePulseMock).toHaveBeenCalledTimes(1);
  });

  it('round-trips corrections through the journal, dropping only the unusable entries', async () => {
    const created = await createPulse('friday was 2400, saturday 880');
    await enrichPulse(created.id, {
      ...SAMPLE_CODING,
      corrections: [
        { date: '2026-08-28', kcal: 2400 },
        { date: '2026-08-29', kcal: 880, proteinG: 150 },
      ],
    });

    // Through a real re-open: the fold is what a second device would read.
    resetSession();
    const row = (await getPulses()).find(candidate => candidate.id === created.id);
    expect(row?.corrections).toEqual([
      { date: '2026-08-28', kcal: 2400 },
      { date: '2026-08-29', kcal: 880, proteinG: 150 },
    ]);
  });
});
