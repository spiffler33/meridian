/**
 * Journal Core — event model and fold
 *
 * The pure heart of the local-first rework: an append-only journal of events,
 * and the fold that rebuilds state from them. No IndexedDB, no fetch, no React,
 * no imports from anywhere else in the app.
 *
 * Every function here is total: malformed input is reported as a warning and
 * skipped, never thrown. A crash on one bad line would take the whole app's
 * state with it.
 */

/** The parts of a journal line that every event carries. */
type JournalEventCore = {
  /** UUID. The dedupe key — journals are fetched from overlapping sources. */
  id: string;
  /** Short device id. */
  device: string;
  /** Per-device monotonic counter. */
  seq: number;
  /** Epoch ms. */
  ts: number;
  entity: string;
  entityId: string;
};

/**
 * One journal line: a single state change, appended by exactly one device.
 *
 * Discriminated on `type` so the compiler agrees with the runtime validator:
 * an upsert without `fields` and a delete carrying `fields` are both type
 * errors, rather than well-typed values that fold rejects or ignores.
 */
export type JournalEvent =
  /** Writes the named fields; every other field of the entity is untouched. */
  | (JournalEventCore & { type: 'upsert'; fields: Record<string, unknown> })
  /** Tombstones the entity over everything older. Carries no payload. */
  | (JournalEventCore & { type: 'delete'; fields?: undefined });

/** A skipped line or event, surfaced to the UI instead of crashing. */
export type FoldWarning = {
  /** Journal file name for parse warnings, 'fold' for events rejected by fold. */
  source: string;
  /** 1-based line number, or 1-based position in the array handed to fold. */
  line: number;
  reason: string;
  snippet: string;
};

/** entity -> entityId -> field -> value. */
export type FoldedState = Record<string, Record<string, Record<string, unknown>>>;

const SNIPPET_MAX = 80;

/** Appended to a snippet that had to be cut, so a short line stays distinguishable. */
const SNIPPET_ELLIPSIS = '…';

/**
 * The total order on events: ascending ts, then device, then seq, then id.
 *
 * The id tiebreak is what makes the order total. (ts, device, seq) alone is
 * not: a seq counter reset, a restored backup, or two contexts sharing a
 * device id all produce distinct events that tie, and a tie would let the
 * winner depend on which journal file happened to be concatenated first —
 * two devices could then disagree forever with no path back to convergence.
 * Only identical ids compare 0, and those are deduped.
 *
 * All string comparison is plain code-unit comparison, NOT locale-aware:
 * every replica must agree on the order regardless of the browser's locale.
 */
export function compareEvents(a: JournalEvent, b: JournalEvent): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
  if (a.device !== b.device) return a.device < b.device ? -1 : 1;
  if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Parse one journal file's text (one JSON object per line).
 *
 * Blank and whitespace-only lines are skipped silently. Anything else that is
 * not a structurally valid event is skipped with a warning carrying its 1-based
 * line number.
 */
export function parseJournalLines(
  text: string,
  source: string
): { events: JournalEvent[]; warnings: FoldWarning[] } {
  const events: JournalEvent[] = [];
  const warnings: FoldWarning[] = [];

  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    if (line.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warnings.push({ source, line: index + 1, reason: 'line is not valid JSON', snippet: toSnippet(raw) });
      continue;
    }

    const checked = validateEvent(parsed);
    if (!checked.ok) {
      warnings.push({ source, line: index + 1, reason: checked.reason, snippet: toSnippet(raw) });
      continue;
    }
    // Accepted, but something in it was ignored — say so rather than swallow it.
    if (checked.warning !== undefined) {
      warnings.push({ source, line: index + 1, reason: checked.warning, snippet: toSnippet(raw) });
    }
    events.push(checked.event);
  }

  return { events, warnings };
}

/**
 * Rebuild state from events: field-level last-writer-wins per (entity, entityId),
 * a delete as a tombstone over everything older, dedupe by event id.
 *
 * An upsert newer than a delete resurrects the entity carrying only the fields
 * written after that delete — intended, and the reason deletes are compared
 * per field rather than as a whole-record flag.
 *
 * Does not mutate the input array, and shares no object with it: every field
 * value is deep-copied on the way in, so mutating the returned state can never
 * rewrite the events it was folded from, and two folds of one array hand back
 * two independent object graphs.
 */
export function fold(events: JournalEvent[]): { state: FoldedState; warnings: FoldWarning[] } {
  const warnings: FoldWarning[] = [];
  // The 1-based input position travels with each event so a warning raised
  // after the sort still points at the line the caller handed us.
  const valid: Array<{ event: JournalEvent; line: number }> = [];

  for (let index = 0; index < events.length; index += 1) {
    const checked = validateEvent(events[index]);
    if (!checked.ok) {
      warnings.push({ source: 'fold', line: index + 1, reason: checked.reason, snippet: toSnippet(events[index]) });
      continue;
    }
    if (checked.warning !== undefined) {
      warnings.push({ source: 'fold', line: index + 1, reason: checked.warning, snippet: toSnippet(events[index]) });
    }
    valid.push({ event: checked.event, line: index + 1 });
  }

  // Sort a copy. Validation already built a fresh array, and slice() keeps the
  // "never reorder the caller's array" guarantee true of this line alone.
  const ordered = valid.slice().sort((a, b) => compareEvents(a.event, b.event));

  const applied = new Map<string, JournalEvent>();
  // entity -> entityId -> track. Maps, not objects, so entity names are never
  // confused with inherited properties.
  const tracks = new Map<string, Map<string, Track>>();

  for (const { event, line } of ordered) {
    const alreadyApplied = applied.get(event.id);
    if (alreadyApplied !== undefined) {
      // An overlapping fetch re-delivering the identical line is the normal
      // case and stays quiet. Two DIFFERENT events sharing an id are not:
      // one of them is being thrown away, and the owner should hear about it.
      if (!isSameEvent(alreadyApplied, event)) {
        warnings.push({
          source: 'fold',
          line,
          reason: 'duplicate event id with different content; the first in event order was kept',
          snippet: toSnippet(event),
        });
      }
      continue;
    }
    applied.set(event.id, event);

    let byId = tracks.get(event.entity);
    if (byId === undefined) {
      byId = new Map<string, Track>();
      tracks.set(event.entity, byId);
    }
    let track = byId.get(event.entityId);
    if (track === undefined) {
      track = { fields: new Map<string, FieldSlot>(), deletedBy: null };
      byId.set(event.entityId, track);
    }

    if (event.type === 'delete') {
      // Events are applied in ascending order, so this is the most recent delete.
      track.deletedBy = event;
      for (const [name, slot] of track.fields) {
        if (compareEvents(slot.writtenBy, event) < 0) track.fields.delete(name);
      }
      continue;
    }

    const fields = event.fields;
    for (const name of Object.keys(fields)) {
      const value = fields[name];
      // An explicit `undefined` is "no write": JSON.stringify erases such a
      // property, so storing it would leave a record that is not what it
      // round-trips to. `null` is a real value and is stored.
      if (value === undefined) continue;
      // These two last-writer guards are belt and braces. Now that the order is
      // total, everything already in the track was applied strictly before this
      // event, so neither can fire while the pre-sort above stands. They are
      // what keeps the fold correct if that ever stops being true.
      const slot = track.fields.get(name);
      if (slot !== undefined && compareEvents(event, slot.writtenBy) <= 0) continue;
      if (track.deletedBy !== null && compareEvents(event, track.deletedBy) <= 0) continue;
      track.fields.set(name, { value: copyValue(value), writtenBy: event });
    }
  }

  return { state: materialize(tracks), warnings };
}

/** A field's surviving value and the event that wrote it. */
type FieldSlot = { value: unknown; writtenBy: JournalEvent };

/** Everything the fold remembers about one (entity, entityId). */
type Track = { fields: Map<string, FieldSlot>; deletedBy: JournalEvent | null };

/**
 * Turn the fold's maps into plain objects.
 *
 * Object.fromEntries defines own properties, so a field or id literally named
 * '__proto__' becomes data rather than rewriting an object's prototype.
 */
function materialize(tracks: Map<string, Map<string, Track>>): FoldedState {
  const entities: Array<[string, Record<string, Record<string, unknown>>]> = [];

  for (const [entity, byId] of tracks) {
    const records: Array<[string, Record<string, unknown>]> = [];
    for (const [entityId, track] of byId) {
      // No surviving fields means the entity is absent from the state entirely.
      if (track.fields.size === 0) continue;
      const values: Array<[string, unknown]> = [];
      for (const [name, slot] of track.fields) values.push([name, slot.value]);
      records.push([entityId, Object.fromEntries(values)]);
    }
    if (records.length > 0) entities.push([entity, Object.fromEntries(records)]);
  }

  return Object.fromEntries(entities);
}

/**
 * Deep copy of one field value, so folded state shares nothing with the events
 * it was built from. Real values here are objects and arrays — a daily entry's
 * thoughts, a completion list — and storing those by reference would make the
 * journal, the parsed JSON, and the app's state one mutable object graph.
 */
function copyValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    // structuredClone is missing on the runtime, or the value holds something
    // it refuses to clone. Journal values are JSON by construction.
    return JSON.parse(JSON.stringify(value));
  }
}

/** Structural equality over JSON-shaped values. Used only to judge duplicates. */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!isSameValue(a[index], b[index])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!isSameValue(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/** True when two events carrying the same id are the same event re-delivered. */
function isSameEvent(a: JournalEvent, b: JournalEvent): boolean {
  if (a.device !== b.device || a.seq !== b.seq || a.ts !== b.ts) return false;
  if (a.entity !== b.entity || a.entityId !== b.entityId) return false;
  if (a.type === 'upsert' && b.type === 'upsert') return isSameValue(a.fields, b.fields);
  return a.type === b.type;
}

type Validation =
  /** `warning` is set when the event is usable but part of it was ignored. */
  | { ok: true; event: JournalEvent; warning?: string }
  | { ok: false; reason: string };

/**
 * Structural check of one candidate event. Explicit typeof checks only — no
 * pattern matching of any kind.
 */
function validateEvent(value: unknown): Validation {
  if (!isPlainObject(value)) return { ok: false, reason: 'event is not a JSON object' };

  const id = value['id'];
  if (typeof id !== 'string') return { ok: false, reason: 'field "id" must be a string' };

  const device = value['device'];
  if (typeof device !== 'string') return { ok: false, reason: 'field "device" must be a string' };

  const seq = value['seq'];
  if (typeof seq !== 'number' || !Number.isFinite(seq)) {
    return { ok: false, reason: 'field "seq" must be a finite number' };
  }

  const ts = value['ts'];
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return { ok: false, reason: 'field "ts" must be a finite number' };
  }

  const type = value['type'];
  if (type !== 'upsert' && type !== 'delete') {
    return { ok: false, reason: 'field "type" must be "upsert" or "delete"' };
  }

  const entity = value['entity'];
  if (typeof entity !== 'string') return { ok: false, reason: 'field "entity" must be a string' };

  const entityId = value['entityId'];
  if (typeof entityId !== 'string') return { ok: false, reason: 'field "entityId" must be a string' };

  const fields = value['fields'];

  if (type === 'delete') {
    const event: JournalEvent = { id, device, seq, ts, type, entity, entityId };
    // The type forbids it, but a hand-edited or foreign line can still carry
    // one. The delete still applies; the payload is dropped, out loud.
    if (fields !== undefined) {
      return { ok: true, event, warning: 'delete carries "fields"; the payload is ignored' };
    }
    return { ok: true, event };
  }

  if (!isPlainObject(fields)) {
    return { ok: false, reason: 'field "fields" must be an object on an upsert' };
  }
  return { ok: true, event: { id, device, seq, ts, type, entity, entityId, fields } };
}

/** True for a JSON object — not null, not an array, not a class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The offending line (or event) trimmed to something safe to show a human.
 *
 * Truncation counts code points, not UTF-16 code units: cutting mid-emoji
 * leaves a lone surrogate, which renders as a replacement glyph and makes
 * encodeURIComponent(snippet) throw.
 */
function toSnippet(value: unknown): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = '[unserializable]';
    }
  }

  const points = Array.from(text);
  if (points.length <= SNIPPET_MAX) return text;
  return points.slice(0, SNIPPET_MAX).join('') + SNIPPET_ELLIPSIS;
}
