import { compareEvents, fold, parseJournalLines } from './journal';
import type { JournalEvent } from './journal';

type UpsertEvent = Extract<JournalEvent, { type: 'upsert' }>;
type DeleteEvent = Extract<JournalEvent, { type: 'delete' }>;

type UpsertSpec = {
  id: string;
  ts: number;
  fields: Record<string, unknown>;
  device?: string;
  seq?: number;
  entity?: string;
  entityId?: string;
};

type DeleteSpec = {
  id: string;
  ts: number;
  device?: string;
  seq?: number;
  entity?: string;
  entityId?: string;
};

function upsert(spec: UpsertSpec): UpsertEvent {
  return {
    id: spec.id,
    device: spec.device ?? 'a',
    seq: spec.seq ?? 1,
    ts: spec.ts,
    type: 'upsert',
    entity: spec.entity ?? 'habit',
    entityId: spec.entityId ?? 'h1',
    fields: spec.fields,
  };
}

function del(spec: DeleteSpec): DeleteEvent {
  return {
    id: spec.id,
    device: spec.device ?? 'a',
    seq: spec.seq ?? 1,
    ts: spec.ts,
    type: 'delete',
    entity: spec.entity ?? 'habit',
    entityId: spec.entityId ?? 'h1',
  };
}

/** One journal line with a required key removed, to model a corrupt file. */
function jsonLineWithout(event: JournalEvent, key: string): string {
  const record: Record<string, unknown> = { ...event };
  delete record[key];
  return JSON.stringify(record);
}

/** The same, but handed straight to fold rather than serialized first. */
function eventWithout(event: JournalEvent, key: string): JournalEvent {
  const record: Record<string, unknown> = { ...event };
  delete record[key];
  return record as unknown as JournalEvent;
}

function toJsonl(events: JournalEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

describe('journal fold engine', () => {
  it('criterion 1 — orders events by ts, then device, then seq', () => {
    const later = upsert({ id: 'later-ts', device: 'a', seq: 1, ts: 200, fields: {} });
    const lowercaseDevice = upsert({ id: 'device-a', device: 'a', seq: 5, ts: 100, fields: {} });
    const uppercaseHighSeq = upsert({ id: 'device-B-seq-9', device: 'B', seq: 9, ts: 100, fields: {} });
    const uppercaseLowSeq = upsert({ id: 'device-B-seq-2', device: 'B', seq: 2, ts: 100, fields: {} });

    const sorted = [later, lowercaseDevice, uppercaseHighSeq, uppercaseLowSeq]
      .slice()
      .sort(compareEvents)
      .map((event) => event.id);

    // 'B' sorts before 'a' by code unit; a locale-aware comparison would invert
    // these two, which is exactly what this module must never do.
    expect(sorted).toEqual(['device-B-seq-2', 'device-B-seq-9', 'device-a', 'later-ts']);
  });

  it('criterion 2 (acceptance C) — the later order key wins when one field is written twice, in either arrival order', () => {
    const older = upsert({ id: 'e-old', device: 'a', seq: 1, ts: 100, fields: { title: 'Run' } });
    const newer = upsert({ id: 'e-new', device: 'a', seq: 2, ts: 200, fields: { title: 'Run 5k' } });

    expect(fold([older, newer]).state['habit']['h1']).toEqual({ title: 'Run 5k' });
    expect(fold([newer, older]).state['habit']['h1']).toEqual({ title: 'Run 5k' });

    // Same ts: the device breaks the tie, so 'b' is the later writer.
    const fromA = upsert({ id: 'e-a', device: 'a', seq: 1, ts: 300, fields: { title: 'from a' } });
    const fromB = upsert({ id: 'e-b', device: 'b', seq: 1, ts: 300, fields: { title: 'from b' } });

    expect(fold([fromA, fromB]).state['habit']['h1']).toEqual({ title: 'from b' });
    expect(fold([fromB, fromA]).state['habit']['h1']).toEqual({ title: 'from b' });
  });

  it('criterion 3 (acceptance C) — two devices writing different fields of one entity merge into a single record', () => {
    const fromA = upsert({ id: 'e-a', device: 'a', seq: 1, ts: 100, fields: { title: 'Run' } });
    const fromB = upsert({ id: 'e-b', device: 'b', seq: 1, ts: 90, fields: { color: 'red' } });

    const { state, warnings } = fold([fromA, fromB]);

    expect(warnings).toEqual([]);
    expect(state).toEqual({ habit: { h1: { title: 'Run', color: 'red' } } });
  });

  it('criterion 4 (acceptance C) — a delete beats an older upsert of the same entityId', () => {
    const created = upsert({ id: 'e-create', device: 'a', seq: 1, ts: 100, fields: { title: 'Run', color: 'red' } });
    const removed = del({ id: 'e-delete', device: 'a', seq: 2, ts: 200 });

    const { state } = fold([created, removed]);

    expect(state['habit']).toBeUndefined();
    expect(state).toEqual({});
  });

  it('criterion 5 (acceptance C) — an upsert newer than a delete resurrects the entity with only post-delete fields', () => {
    const created = upsert({ id: 'e-create', device: 'a', seq: 1, ts: 100, fields: { title: 'Run', color: 'red' } });
    const removed = del({ id: 'e-delete', device: 'a', seq: 2, ts: 200 });
    const revived = upsert({ id: 'e-revive', device: 'a', seq: 3, ts: 300, fields: { color: 'blue' } });

    const { state } = fold([created, removed, revived]);

    expect(state).toEqual({ habit: { h1: { color: 'blue' } } });
  });

  it('criterion 6 — the same event id present in two sources is applied exactly once', () => {
    const shared = upsert({ id: 'dup-1', device: 'a', seq: 1, ts: 100, fields: { count: 1 } });
    const onlyInA = upsert({ id: 'a-2', device: 'a', seq: 2, ts: 150, fields: { label: 'from a' } });
    const onlyInB = upsert({ id: 'b-1', device: 'b', seq: 1, ts: 120, fields: { other: 'from b' } });

    const fileA = parseJournalLines(toJsonl([shared, onlyInA]), 'journal/2026-08.a.jsonl');
    const fileB = parseJournalLines(toJsonl([shared, onlyInB]), 'journal/2026-08.b.jsonl');

    expect(fileA.warnings).toEqual([]);
    expect(fileB.warnings).toEqual([]);
    expect([...fileA.events, ...fileB.events]).toHaveLength(4);

    const once = fold([shared, onlyInA, onlyInB]);
    const overlapping = fold([...fileA.events, ...fileB.events]);

    expect(overlapping.state).toEqual(once.state);
    expect(overlapping.state['habit']['h1']).toEqual({ count: 1, label: 'from a', other: 'from b' });
    // The re-delivered line is byte-identical, so the overlap is not a conflict.
    expect(overlapping.warnings).toEqual([]);

    // A replay of the same id carrying a different value must be skipped whole:
    // if it were applied a second time, count would become 999.
    const replayed = fold([
      ...fileA.events,
      ...fileB.events,
      upsert({ id: 'dup-1', device: 'a', seq: 9, ts: 900, fields: { count: 999 } }),
    ]);

    expect(replayed.state['habit']['h1']['count']).toBe(1);
    expect(replayed.state).toEqual(once.state);
  });

  it('criterion 7 (acceptance F) — an unparseable line is warned with its 1-based line number while the good lines fold', () => {
    const good1 = upsert({ id: 'e-1', device: 'a', seq: 1, ts: 100, fields: { title: 'Run' } });
    const good2 = upsert({ id: 'e-2', device: 'a', seq: 2, ts: 200, fields: { color: 'red' } });
    const brokenLine = '{"id": "broken", "device"';
    const text = [JSON.stringify(good1), brokenLine, '', '   ', JSON.stringify(good2)].join('\n');

    const { events, warnings } = parseJournalLines(text, 'journal/2026-08.a.jsonl');

    expect(events.map((event) => event.id)).toEqual(['e-1', 'e-2']);
    // Blank and whitespace-only lines are skipped silently, so only line 2 warns.
    expect(warnings).toEqual([
      {
        source: 'journal/2026-08.a.jsonl',
        line: 2,
        reason: 'line is not valid JSON',
        snippet: brokenLine,
      },
    ]);

    expect(fold(events).state).toEqual({ habit: { h1: { title: 'Run', color: 'red' } } });
  });

  it('criterion 7b (acceptance F) — structurally invalid but parseable lines each warn at their 1-based line while the valid event folds', () => {
    const template = upsert({ id: 'e-bad', device: 'a', seq: 1, ts: 100, fields: { title: 'nope' } });
    const missingEntityId = jsonLineWithout(template, 'entityId');
    const unknownType = JSON.stringify({ ...template, type: 'patch' });
    const upsertWithoutFields = jsonLineWithout(template, 'fields');
    const jsonArray = '[1, 2, 3]';
    const whitespaceOnly = '   ';
    const good = upsert({ id: 'e-good', device: 'a', seq: 2, ts: 200, fields: { title: 'Run' } });

    const lines = [
      missingEntityId,
      unknownType,
      whitespaceOnly,
      upsertWithoutFields,
      jsonArray,
      JSON.stringify(good),
    ];
    const { events, warnings } = parseJournalLines(lines.join('\n'), 'journal/2026-08.a.jsonl');

    expect(events.map((event) => event.id)).toEqual(['e-good']);
    // Line 3 is whitespace-only: skipped silently, and it does not shift the
    // numbering of the corrupt lines after it. Each rejection carries the
    // reason for THAT branch — it is the owner's only account of a lost line.
    // Snippets are literal here on purpose: deriving them from the source line
    // with the implementation's own truncation would assert nothing.
    expect(warnings).toEqual([
      {
        source: 'journal/2026-08.a.jsonl',
        line: 1,
        reason: 'field "entityId" must be a string',
        snippet: '{"id":"e-bad","device":"a","seq":1,"ts":100,"type":"upsert","entity":"habit","fi…',
      },
      {
        source: 'journal/2026-08.a.jsonl',
        line: 2,
        reason: 'field "type" must be "upsert" or "delete"',
        snippet: '{"id":"e-bad","device":"a","seq":1,"ts":100,"type":"patch","entity":"habit","ent…',
      },
      {
        source: 'journal/2026-08.a.jsonl',
        line: 4,
        reason: 'field "fields" must be an object on an upsert',
        snippet: '{"id":"e-bad","device":"a","seq":1,"ts":100,"type":"upsert","entity":"habit","en…',
      },
      {
        source: 'journal/2026-08.a.jsonl',
        line: 5,
        reason: 'event is not a JSON object',
        snippet: '[1, 2, 3]',
      },
    ]);

    expect(fold(events).state).toEqual({ habit: { h1: { title: 'Run' } } });
  });

  it('criterion 8 — a shuffled event set folds to a deeply equal state', () => {
    const events: JournalEvent[] = [
      upsert({ id: 'e1', device: 'a', seq: 1, ts: 100, entityId: 'h1', fields: { title: 'Run', color: 'red' } }),
      upsert({ id: 'e2', device: 'b', seq: 1, ts: 100, entityId: 'h1', fields: { color: 'blue' } }),
      upsert({ id: 'e3', device: 'a', seq: 2, ts: 150, entityId: 'h2', fields: { title: 'Read' } }),
      del({ id: 'e4', device: 'b', seq: 2, ts: 200, entityId: 'h1' }),
      upsert({ id: 'e5', device: 'a', seq: 3, ts: 300, entityId: 'h1', fields: { streak: 4 } }),
      upsert({ id: 'e6', device: 'c', seq: 1, ts: 250, entity: 'tower', entityId: 't1', fields: { label: 'Ship it' } }),
      del({ id: 'e7', device: 'c', seq: 2, ts: 400, entityId: 'h2' }),
      upsert({ id: 'e1', device: 'a', seq: 1, ts: 100, entityId: 'h1', fields: { title: 'Run', color: 'red' } }),
      upsert({ id: 'e8', device: 'a', seq: 4, ts: 500, entity: 'tower', entityId: 't1', fields: { label: 'Shipped', done: true } }),
    ];
    const expected = {
      habit: { h1: { streak: 4 } },
      tower: { t1: { label: 'Shipped', done: true } },
    };
    const arrivalOrder = events.map((event) => event.id);

    expect(fold(events).state).toEqual(expected);

    const orderings: JournalEvent[][] = [events.slice().reverse()];
    for (let n = 1; n < events.length; n += 1) {
      orderings.push(events.slice(n).concat(events.slice(0, n)));
    }
    for (const ordering of orderings) {
      const { state, warnings } = fold(ordering);
      expect(warnings).toEqual([]);
      expect(state).toEqual(expected);
    }

    // fold sorts a copy: the caller's array is left exactly as it was.
    expect(events.map((event) => event.id)).toEqual(arrivalOrder);
  });

  it('criterion 9 (F1) — the order is total: events tied on (ts, device, seq) are separated by id', () => {
    const early = upsert({ id: 'aaa', device: 'a', seq: 1, ts: 100, fields: { title: 'Morning run' } });
    const late = upsert({ id: 'zzz', device: 'a', seq: 1, ts: 100, fields: { title: 'Evening run' } });

    // Antisymmetric, and 0 only for the identical event — which is what makes
    // the sort independent of which journal file was concatenated first.
    expect(compareEvents(early, late)).toBeLessThan(0);
    expect(compareEvents(late, early)).toBeGreaterThan(0);
    expect(compareEvents(early, early)).toBe(0);

    expect([late, early].sort(compareEvents).map((event) => event.id)).toEqual(['aaa', 'zzz']);
    expect([early, late].sort(compareEvents).map((event) => event.id)).toEqual(['aaa', 'zzz']);
  });

  it('criterion 10 (F1) — two tied upserts of one field resolve identically in both arrival orders', () => {
    const early = upsert({ id: 'aaa', device: 'a', seq: 1, ts: 100, fields: { title: 'Morning run' } });
    const late = upsert({ id: 'zzz', device: 'a', seq: 1, ts: 100, fields: { title: 'Evening run' } });

    expect(fold([early, late]).state['habit']['h1']).toEqual({ title: 'Evening run' });
    expect(fold([late, early]).state['habit']['h1']).toEqual({ title: 'Evening run' });

    // The same thing through the real path: two device journals, fetched in
    // whichever order the file listing came back in.
    const fileA = parseJournalLines(toJsonl([early]), 'journal/2026-08.a.jsonl');
    const fileB = parseJournalLines(toJsonl([late]), 'journal/2026-08.b.jsonl');
    expect(fileA.warnings).toEqual([]);
    expect(fileB.warnings).toEqual([]);

    const expected = { habit: { h1: { title: 'Evening run' } } };
    expect(fold([...fileA.events, ...fileB.events]).state).toEqual(expected);
    expect(fold([...fileB.events, ...fileA.events]).state).toEqual(expected);
  });

  it('criterion 11 (F1) — a tied upsert and delete resolve identically in both arrival orders', () => {
    const write = upsert({ id: 'aaa', device: 'a', seq: 1, ts: 100, fields: { title: 'Run' } });
    const remove = del({ id: 'zzz', device: 'a', seq: 1, ts: 100 });

    // 'zzz' > 'aaa', so the delete is the later event and the habit is gone.
    // Without a total order the entity survives its own delete in one order.
    expect(fold([write, remove]).state).toEqual({});
    expect(fold([remove, write]).state).toEqual({});

    // Flip which side holds the higher id and the outcome flips with it —
    // still the same in both arrival orders.
    const laterWrite = upsert({ id: 'zzz', device: 'a', seq: 1, ts: 100, fields: { title: 'Run' } });
    const earlierRemove = del({ id: 'aaa', device: 'a', seq: 1, ts: 100 });

    expect(fold([laterWrite, earlierRemove]).state).toEqual({ habit: { h1: { title: 'Run' } } });
    expect(fold([earlierRemove, laterWrite]).state).toEqual({ habit: { h1: { title: 'Run' } } });

    const fileA = parseJournalLines(toJsonl([write]), 'journal/2026-08.a.jsonl');
    const fileB = parseJournalLines(toJsonl([remove]), 'journal/2026-08.b.jsonl');
    expect(fold([...fileA.events, ...fileB.events]).state).toEqual({});
    expect(fold([...fileB.events, ...fileA.events]).state).toEqual({});
  });

  it('criterion 12 (T2) — fold reports its own rejects with source "fold", the 1-based array position, and an object snippet', () => {
    const good = upsert({ id: 'e-good', device: 'a', seq: 2, ts: 200, fields: { title: 'Run' } });
    const template = upsert({ id: 'e-bad', device: 'a', seq: 1, ts: 100, fields: { title: 'nope' } });

    // An event object that never went through a file, so its snippet comes from
    // the object path rather than a raw line.
    const circular: Record<string, unknown> = {
      id: 'e-circular',
      device: 'a',
      seq: 3,
      ts: 300,
      type: 'upsert',
      entity: 'habit',
    };
    circular['self'] = circular;

    const { state, warnings } = fold([
      good,
      eventWithout(template, 'entityId'),
      42 as unknown as JournalEvent,
      circular as unknown as JournalEvent,
    ]);

    expect(state).toEqual({ habit: { h1: { title: 'Run' } } });
    expect(warnings).toEqual([
      {
        source: 'fold',
        line: 2,
        reason: 'field "entityId" must be a string',
        snippet: '{"id":"e-bad","device":"a","seq":1,"ts":100,"type":"upsert","entity":"habit","fi…',
      },
      { source: 'fold', line: 3, reason: 'event is not a JSON object', snippet: '42' },
      { source: 'fold', line: 4, reason: 'field "entityId" must be a string', snippet: '[unserializable]' },
    ]);
  });

  it('criterion 13 (F3) — snippets are cut on code points, never mid-emoji, and say that they were cut', () => {
    const short = 'not json';
    const digits = '0123456789'.repeat(12);
    // The emoji straddles UTF-16 code unit 80: a code-unit cut leaves a lone
    // high surrogate, which renders as a replacement glyph and makes
    // encodeURIComponent throw.
    const straddling = 'x'.repeat(79) + '😀' + 'tail';

    const { warnings } = parseJournalLines([short, digits, straddling].join('\n'), 'journal/2026-08.a.jsonl');

    expect(warnings.map((warning) => warning.line)).toEqual([1, 2, 3]);
    // A complete short line carries no marker, so it stays distinguishable.
    expect(warnings[0].snippet).toBe('not json');
    expect(warnings[1].snippet).toBe(
      '01234567890123456789012345678901234567890123456789012345678901234567890123456789…'
    );
    expect(warnings[2].snippet).toBe('x'.repeat(79) + '😀…');
    expect(Array.from(warnings[2].snippet)).toHaveLength(81);
    expect(() => encodeURIComponent(warnings[2].snippet)).not.toThrow();
  });

  it('criterion 14 (F2) — folded state shares no object with the events it was folded from', () => {
    const thoughts = { morning: 'wrote', evening: null };
    const entry = upsert({
      id: 'e-daily',
      device: 'a',
      seq: 1,
      ts: 100,
      entity: 'daily',
      entityId: '2026-08-23',
      fields: { thoughts, done: ['h1', 'h2'] },
    });
    const events = [entry];

    const first = fold(events);
    const record = first.state['daily']['2026-08-23'];
    expect(record['thoughts']).not.toBe(thoughts);
    expect(record['done']).not.toBe(entry.fields['done']);

    // Editing what one screen was handed must not rewrite the journal...
    (record['thoughts'] as Record<string, unknown>)['morning'] = 'REWRITTEN';
    (record['done'] as string[]).push('h3');
    expect(thoughts).toEqual({ morning: 'wrote', evening: null });
    expect(entry.fields['thoughts']).toEqual({ morning: 'wrote', evening: null });
    expect(entry.fields['done']).toEqual(['h1', 'h2']);

    // ...so re-folding the untouched array still reports what the journal said.
    const second = fold(events);
    expect(second.state['daily']['2026-08-23']).toEqual({
      thoughts: { morning: 'wrote', evening: null },
      done: ['h1', 'h2'],
    });

    // ...and two folds must not hand two screens the same leaf object.
    expect(second.state['daily']['2026-08-23']['thoughts']).not.toBe(record['thoughts']);
    expect(second.state['daily']['2026-08-23']['done']).not.toBe(record['done']);
  });

  it('criterion 15 (F4) — a duplicate id carrying different content warns, an identical re-delivery does not', () => {
    const original = upsert({ id: 'same-id', device: 'a', seq: 1, ts: 100, entityId: 'h1', fields: { label: 'Run' } });
    const conflicting = upsert({ id: 'same-id', device: 'a', seq: 2, ts: 100, entityId: 'h2', fields: { label: 'Read' } });

    const conflicted = fold([original, conflicting]);

    // Dedupe still keeps exactly one — but not silently.
    expect(conflicted.state).toEqual({ habit: { h1: { label: 'Run' } } });
    expect(conflicted.warnings).toHaveLength(1);
    expect(conflicted.warnings[0].source).toBe('fold');
    expect(conflicted.warnings[0].line).toBe(2);
    expect(conflicted.warnings[0].reason).toBe(
      'duplicate event id with different content; the first in event order was kept'
    );

    // Same id, different kind of event: also a conflict.
    const typeClash = fold([original, del({ id: 'same-id', device: 'a', seq: 2, ts: 100, entityId: 'h1' })]);
    expect(typeClash.warnings).toHaveLength(1);
    expect(typeClash.state).toEqual({ habit: { h1: { label: 'Run' } } });

    // The overlapping-fetch case: the identical line delivered twice is normal
    // and must stay quiet, including when the value is a nested object.
    const nested = upsert({ id: 'nested', device: 'a', seq: 3, ts: 100, fields: { thoughts: { morning: 'a' }, tags: ['x'] } });
    const copy = upsert({ id: 'nested', device: 'a', seq: 3, ts: 100, fields: { thoughts: { morning: 'a' }, tags: ['x'] } });
    expect(fold([original, nested, copy]).warnings).toEqual([]);
  });

  it('criterion 16 (F6) — an explicit undefined field value is not written, while null is stored', () => {
    const event = upsert({
      id: 'e-1',
      device: 'a',
      seq: 1,
      ts: 100,
      fields: { note: undefined, reflection: null, title: 'Run' },
    });

    const { state, warnings } = fold([event]);
    const record = state['habit']['h1'];

    expect(warnings).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(record, 'note')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(record, 'reflection')).toBe(true);
    expect(record).toStrictEqual({ reflection: null, title: 'Run' });

    // The folded record is what it serializes to — no property that vanishes.
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);

    // An upsert whose only field is undefined writes nothing at all.
    const empty = fold([upsert({ id: 'e-2', device: 'a', seq: 2, ts: 200, entityId: 'h2', fields: { note: undefined } })]);
    expect(empty.state).toEqual({});
  });

  it('criterion 17 (F5) — the event type and the validator agree: an upsert must carry fields, a delete must not', () => {
    // @ts-expect-error an upsert without "fields" is a compile error, not a silent runtime drop
    const upsertWithoutFields: JournalEvent = { id: 'e-1', device: 'a', seq: 1, ts: 100, type: 'upsert', entity: 'habit', entityId: 'h1' };
    // @ts-expect-error a delete carrying "fields" is a compile error
    const deleteWithFields: JournalEvent = { id: 'e-2', device: 'a', seq: 2, ts: 200, type: 'delete', entity: 'habit', entityId: 'h1', fields: { title: 'nope' } };

    const rejected = fold([upsertWithoutFields]);
    expect(rejected.state).toEqual({});
    expect(rejected.warnings).toEqual([
      {
        source: 'fold',
        line: 1,
        reason: 'field "fields" must be an object on an upsert',
        snippet: '{"id":"e-1","device":"a","seq":1,"ts":100,"type":"upsert","entity":"habit","enti…',
      },
    ]);

    // A delete that reaches the runtime with a payload still deletes, and says
    // out loud that the payload was thrown away.
    const created = upsert({ id: 'e-0', device: 'a', seq: 1, ts: 100, fields: { title: 'Run' } });
    const withPayload = fold([created, deleteWithFields]);

    expect(withPayload.state).toEqual({});
    expect(withPayload.warnings).toEqual([
      {
        source: 'fold',
        line: 2,
        reason: 'delete carries "fields"; the payload is ignored',
        snippet: '{"id":"e-2","device":"a","seq":2,"ts":200,"type":"delete","entity":"habit","enti…',
      },
    ]);
  });
});
