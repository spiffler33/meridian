/**
 * The coder: one Anthropic call that classifies a pulse.
 *
 * The same separation the US national time-use survey uses — free-form diary
 * first, trained coders after — because natural-language activity needs
 * judgment, not string matching. Here the coder is a model, and this file is
 * its whole contract: what it is shown (Appendix B's allowlist), what it must
 * answer (Appendix B's schema), and the one call that connects them.
 *
 * Reuses `claude.ts`'s proven request shape (plain `fetch`, no SDK, no
 * streaming) and its `loadApiKey()`. `claude.ts`'s two legacy functions are
 * untouched — they are the AI-on-life-support prose path; this is the
 * deliberate rebuild, and it owns nothing else in that file.
 *
 * Cost note: 30 pulses/day ≈ $6/month on Sonnet 5 (≈$2 on Haiku), at ~1.6K
 * input + ~150 output tokens a call. No caching: the stable prefix (this
 * file's system prompt) sits under the ~1K-token cacheable minimum, and
 * pulses are scattered past the cache TTL anyway.
 *
 * Failure has exactly one shape here, by design (fence 2): a bad key, a
 * dead network, a non-2xx response, or JSON the schema rejects all return
 * `null`. There is no error taxonomy, no retry ladder, and nothing here ever
 * reacts to a bad parse with a rule over the pulse's own text — an unusable
 * answer means the pulse stays uncoded, which is a correct, finished outcome.
 */

import { loadApiKey } from './claude';
import type {
  PulseEffect,
  PulseEffectType,
  PulseLinks,
  PulseSignal,
  PulseSpan,
  PulseVocabProposal,
  PulseVocabProposalKind,
  PulseVocabRow,
} from '../lib/entities';

/** One line to flip at Gate 2 if the miscoding rate says so. */
export const CODER_MODEL = 'claude-sonnet-5';

/** Appendix B's ceiling. Typical output is ~150 tokens; this is the cap, not the target. */
const MAX_OUTPUT_TOKENS = 500;

/**
 * Same ceiling as the GitHub write (`github.ts`'s `REQUEST_TIMEOUT_MS`), for
 * the same reason: one connection that hangs rather than fails must not wedge
 * every pulse behind it in the sweep until the tab is reloaded.
 */
const CODER_TIMEOUT_MS = 30_000;

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/** Which capture surface produced the pulse. `tower` biases the model toward `task`. */
export type Mouth = 'today' | 'tower';

/** Appendix B's `vocab` slice: the full pulseVocab row, minus its id. */
export type CoderVocab = Omit<PulseVocabRow, 'id'>;

/** One of the last five pulses before this one, with its coding if it has one. */
export type RecentPulse = { text: string; coding?: PulseEnrichment };

/**
 * The context allowlist (fence 5, Appendix B) — the payload contains these
 * slices and nothing else. Never tokens, never reading content, never journal
 * history beyond `recentPulses`. `text` itself is a separate argument to
 * `codePulse`, not a member here, but it rides in the same wire payload.
 */
export type CoderContext = {
  /**
   * The pulse's own instant, not the sweep's wall clock.
   *
   * An interpretation, recorded here so Gate 2 can see it: Appendix B's
   * allowlist is law and has no field for the pulse's `at`, but it does have
   * `now`, and nothing in the plan says `now` means "when the request was
   * sent". The queue exists to code a pulse hours or days late, so a coder
   * resolving "gym at 6" against the sweep's clock would put a Thursday
   * utterance on Saturday — silently, and permanently, since a coded pulse is
   * never revisited. For someone classifying a diary entry, "now" is the
   * entry's moment. Everything time-shaped in the payload follows it:
   * `todayEvents` and `todayHabits` are the pulse's local day.
   */
  now: string;
  tz: string;
  vocab: CoderVocab;
  todayEvents: Array<{ id: string; title: string; calendar: string; start: string; end: string }>;
  todayHabits: Array<{ id: string; name: string; done: boolean }>;
  openTowerItems: Array<{ id: string; text: string; status: string }>;
  recentPulses: RecentPulse[];
  mouth: Mouth;
};

/**
 * Appendix C's effects and the vocabulary proposal. Defined in `entities.ts`
 * with the rest of the pulse row's shape — they are stored on the pulse, not
 * merely read off the wire (see `PulseRow`'s own note on that amendment).
 */
export type EffectType = PulseEffectType;
export type Effect = PulseEffect;
export type VocabProposalKind = PulseVocabProposalKind;
export type VocabProposal = PulseVocabProposal;

/** Appendix B's output schema, in full. */
export type Coding = {
  signal: PulseSignal;
  domain: string | null;
  activity: string | null;
  people: string[];
  span: PulseSpan;
  links: PulseLinks;
  effects: Effect[];
  vocabProposal: VocabProposal | null;
};

/**
 * What a coded pulse looks like when it is shown BACK to the coder, in
 * `recentPulses`: the six fields that describe the utterance itself.
 *
 * Deliberately not the whole `Coding`. `effects` and `vocabProposal` are
 * proposals about what to do next, awaiting the owner's tap — they are stored
 * on the row (see `PulseRow`) but they are not context for classifying the
 * next line, and Appendix B's allowlist is a subset test, not a maximum.
 */
export type PulseEnrichment = Pick<Coding, 'signal' | 'domain' | 'activity' | 'people' | 'span' | 'links'>;

const SIGNALS: readonly PulseSignal[] = ['block', 'event', 'state', 'plan', 'task', 'claim', 'note'];
const EFFECT_TYPES: readonly EffectType[] = ['completeHabit', 'spawnTask', 'updateTask', 'claimEvent'];
const VOCAB_PROPOSAL_KINDS: readonly VocabProposalKind[] = ['domain', 'activity', 'person', 'habitAlias'];

/** Appendix B's output schema, transcribed verbatim. */
const OUTPUT_SCHEMA = `{
  "signal": "block|event|state|plan|task|claim|note",
  "domain": null, "activity": null, "people": [],
  "span": {"start": "...", "end": null, "approx": false},
  "links": {"habitId": null, "towerId": null, "eventId": null},
  "effects": [{"type": "completeHabit|spawnTask|updateTask|claimEvent", "...": "..."}],
  "vocabProposal": {"kind": "domain|activity|person|habitAlias", "value": "...", "mapsTo": null}
}`;

/** Appendix B's rules given to the model, transcribed verbatim. */
const RULES =
  'nulls over guesses; signal always set (note when unsure); never invent people, habits, ' +
  'events, or tasks not present in context; time expressions resolved against now and tz; ' +
  'mouth: tower biases toward task.';

const SYSTEM_PROMPT = `You classify one captured utterance (pulse) for Meridian, the way a time-use \
survey's trained coders classify a diary entry — judgment over the utterance and the context you \
are given, never string matching. Respond with strict JSON only, matching exactly this shape — no \
prose, no markdown fences, nothing before or after it:

${OUTPUT_SCHEMA}

Rules given to the model: ${RULES}`;

/**
 * One Anthropic call: classify `text` against `context`. Returns the coding,
 * or `null` for absolutely any reason it could not be produced — no key, no
 * network, a non-2xx response, or JSON that fails validation. Callers treat
 * `null` as "leave the pulse uncoded", never as something to retry or work
 * around.
 */
export async function codePulse(text: string, context: CoderContext): Promise<Coding | null> {
  const apiKey = await loadApiKey();
  if (!apiKey) return null;

  const payload = { text, ...context };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CODER_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CODER_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        // A classification call needs no reasoning, and reasoning would
        // compete with a 500-token ceiling meant entirely for the answer.
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
      signal: controller.signal,
    });
  } catch {
    // Offline, DNS, CORS, timed out — every network failure collapses here.
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  return parseCoding(body, context.now);
}

/**
 * The response's first text content block, JSON-parsed and validated — or null.
 *
 * A `max_tokens` stop is rejected before the text is even looked at. Truncated
 * JSON fails `JSON.parse` anyway today, but only by luck: this makes "the
 * model ran out of room" a stated failure rather than an accident of where the
 * cut landed, and one that cannot be mistaken for a usable partial coding.
 */
function parseCoding(body: unknown, fallbackStart: string): Coding | null {
  if (typeof body !== 'object' || body === null) return null;
  if ((body as { stop_reason?: unknown }).stop_reason === 'max_tokens') return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;

  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    if ((block as { type?: unknown }).type !== 'text') continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== 'string') continue;

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    return toCoding(raw, fallbackStart);
  }

  return null;
}

/**
 * `signal` is the only field this hard-gates on: it is the one thing Appendix
 * B says is always set, and a value outside the seven the model was given
 * means the response cannot be trusted at all. Everything else degrades to a
 * safe default on a shape mismatch, matching the model's own "nulls over
 * guesses" instruction rather than discarding an otherwise-usable coding.
 */
function toCoding(raw: unknown, fallbackStart: string): Coding | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const signal = value.signal;
  if (typeof signal !== 'string' || !(SIGNALS as readonly string[]).includes(signal)) return null;

  return {
    signal: signal as PulseSignal,
    domain: nullableString(value.domain),
    activity: nullableString(value.activity),
    people: stringArray(value.people),
    span: toSpan(value.span, fallbackStart),
    links: toLinks(value.links),
    effects: toEffects(value.effects),
    vocabProposal: toVocabProposal(value.vocabProposal),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Appendix A: "start defaults to `ts`". `fallbackStart` is that default — the
 * pulse's own instant, which `context.now` carries (see `CoderContext.now`).
 *
 * It is never `''`. An empty start round-trips into a journal that can never
 * be compacted, and phase 3's ledger reads `span.start` straight into a
 * `Date`, where `''` is `Invalid Date` rather than a missing value it could
 * skip. The same default `recentPulsesFor` already applies when it hands an
 * older coding back to the model.
 */
function toSpan(value: unknown, fallbackStart: string): PulseSpan {
  if (typeof value !== 'object' || value === null) return { start: fallbackStart, end: null, approx: false };
  const obj = value as Record<string, unknown>;
  return {
    start: typeof obj.start === 'string' && obj.start.length > 0 ? obj.start : fallbackStart,
    end: typeof obj.end === 'string' ? obj.end : null,
    approx: typeof obj.approx === 'boolean' ? obj.approx : false,
  };
}

function toLinks(value: unknown): PulseLinks {
  if (typeof value !== 'object' || value === null) return { habitId: null, towerId: null, eventId: null };
  const obj = value as Record<string, unknown>;
  return {
    habitId: nullableString(obj.habitId),
    towerId: nullableString(obj.towerId),
    eventId: nullableString(obj.eventId),
  };
}

function toEffects(value: unknown): Effect[] {
  if (!Array.isArray(value)) return [];
  const effects: Effect[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const type = (item as Record<string, unknown>).type;
    if (typeof type === 'string' && (EFFECT_TYPES as readonly string[]).includes(type)) {
      effects.push(item as Effect);
    }
  }
  return effects;
}

function toVocabProposal(value: unknown): VocabProposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== 'string' || !(VOCAB_PROPOSAL_KINDS as readonly string[]).includes(kind)) return null;
  const proposalValue = obj.value;
  if (typeof proposalValue !== 'string') return null;
  return { kind: kind as VocabProposalKind, value: proposalValue, mapsTo: nullableString(obj.mapsTo) };
}
