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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, enqueue } from './db';
import { ENTITY, resetSession } from './entities';
import type { PulseRow } from './entities';
import { fold } from './journal';
import type { JournalEvent } from './journal';
import { compareOldestFirst, pulsesForDay } from './pulse';
import { getPulses } from '../services/data';

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
