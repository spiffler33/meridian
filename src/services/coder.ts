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
 * streaming) and its `loadApiKey()`. `claude.ts`'s one legacy function is
 * untouched — it is the AI-on-life-support prose path; this is the
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
import { parseCorrections } from '../lib/entities';
import type {
  NutritionSource,
  PulseEffect,
  PulseEffectType,
  PulseCorrection,
  PulseLinks,
  PulseNutrition,
  PulseSignal,
  PulseSpan,
  PulseVocabProposal,
  PulseVocabProposalKind,
  PulseVocabRow,
} from '../lib/entities';

/** One line to flip at Gate 2 if the miscoding rate says so. */
export const CODER_MODEL = 'claude-sonnet-5';

/**
 * The revision of the coding schema this build produces.
 *
 * Rev 2 carried `nutrition`; rev 3 adds `corrections`. It exists for exactly one reader:
 * the owner-invoked backfill, which selects pulses coded at a lower rev and
 * re-codes them. Nothing else may branch on it — in particular the ambient
 * sweep must not, or every re-open would re-code the entire history at the
 * owner's expense (a regression test pins that).
 *
 * Bump it when a schema change makes an older coding worth redoing, and only
 * then: a bump is a bill.
 */
export const CODER_REV = 3;

/**
 * A rough per-pulse cost, in US dollars, for the backfill's confirmation line.
 *
 * Sonnet 5 at $3/$15 per million tokens, against this file's own measured
 * shape: ~1.8K input (the system prompt, the vocabulary, a day of events and
 * five recent pulses) and ~150 output. That is ~$0.0075, rounded up here —
 * the number's job is to stop the owner spending more than they meant to, so
 * it should never read low. It is not billing; it is a warning label.
 */
export const APPROX_COST_PER_PULSE_USD = 0.01;

/**
 * The cap, not the target. Typical *answer* is ~150 tokens.
 *
 * Raised from Appendix B's 500 when thinking was turned on: adaptive thinking
 * spends from the same ceiling, and a coding cut off at `max_tokens` is
 * rejected outright by `parseCoding` — the pulse would stay uncoded with no
 * way to tell that from a network failure. Measured spend with `effort: 'low'`
 * is ~186 output tokens, essentially unchanged from the 189 it averaged with
 * thinking disabled, so the headroom costs nothing in practice.
 */
const MAX_OUTPUT_TOKENS = 2000;

/**
 * Same ceiling as the GitHub write (`github.ts`'s `REQUEST_TIMEOUT_MS`), for
 * the same reason: one connection that hangs rather than fails must not wedge
 * every pulse behind it in the sweep until the tab is reloaded.
 */
const CODER_TIMEOUT_MS = 30_000;

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

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
   * `todayEvents` is the pulse's local day.
   */
  now: string;
  tz: string;
  /** Appendix B's `vocab` slice: the full pulseVocab row, minus its id. */
  vocab: Omit<PulseVocabRow, 'id'>;
  todayEvents: Array<{ id: string; title: string; calendar: string; start: string; end: string }>;
  recentPulses: RecentPulse[];
};

/** Appendix B's output schema, in full. */
export type Coding = {
  signal: PulseSignal;
  domain: string | null;
  activity: string | null;
  people: string[];
  span: PulseSpan;
  links: PulseLinks;
  /**
   * What the owner consumed, or `null` for an utterance that is not about
   * them consuming anything.
   *
   * `null` here is a written value, not an omission: a re-code that decides a
   * pulse was never food has to be able to CLEAR a nutrition block an earlier
   * revision wrote, and field-level last-writer-wins only clears what is
   * explicitly written. The distinction the ledger reads — no food at all
   * versus food it could not count — lives one level down, in `kcal`.
   */
  nutrition: PulseNutrition | null;
  /**
   * Day totals the owner asserted in this utterance — zero, one, or several.
   *
   * An array rather than a single value because one sentence can settle more
   * than one day ("friday was 2400, saturday's 880 is right"), and because
   * the empty array is the ordinary answer for every pulse that is not about
   * a day's total at all.
   */
  corrections: PulseCorrection[];
  /** Always `CODER_REV`. See `toCoding` for why the model's own answer is not trusted. */
  coderRev: number;
  effects: PulseEffect[];
  vocabProposal: PulseVocabProposal | null;
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
const EFFECT_TYPES: readonly PulseEffectType[] = ['claimEvent'];
const VOCAB_PROPOSAL_KINDS: readonly PulseVocabProposalKind[] = ['domain', 'activity', 'person'];

/**
 * Appendix B's output schema, transcribed verbatim — placeholder included.
 * `EFFECT_PAYLOADS` below is what its `"...": "..."` stands for.
 */
const OUTPUT_SCHEMA = `{
  "signal": "block|event|state|plan|task|claim|note",
  "domain": null, "activity": null, "people": [],
  "span": {"start": "...", "end": null, "approx": false},
  "links": {"eventId": null},
  "nutrition": {"kcal": null, "kcalSource": "stated|estimated",
                "proteinG": null, "proteinSource": "stated|estimated"},
  "corrections": [{"date": "YYYY-MM-DD", "kcal": 0, "proteinG": null}],
  "coderRev": 3,
  "effects": [{"type": "claimEvent", "...": "..."}],
  "vocabProposal": {"kind": "domain|activity|person", "value": "...", "mapsTo": null}
}`;

/**
 * What Appendix B's `"...": "..."` placeholder stands for: the exact keys each
 * effect type carries.
 *
 * Appendix B left an effect's payload unwritten, so the model was never told
 * what one looks like — while the chips read these keys and only these. An
 * effect answering with a key spelled any other way renders a bare chip whose
 * tap writes nothing, and the proposal is dropped: a silently dead feature
 * rather than a visible failure.
 *
 * The fix is here, in the prompt, and it cannot be anywhere else. Matching a
 * variant spelling back to a key in the chip code would be a string rule over
 * the model's output — the same fence as a string rule over the owner's text,
 * and worse, since it would hide exactly the miscoding Gate 2 exists to see.
 *
 * Every id named here comes out of the context the model was given, which is
 * what makes an effect resolvable by id alone at apply time.
 */
const EFFECT_PAYLOADS = `claimEvent: {"type": "claimEvent", "eventId": "<an id from todayEvents>"}`;


/** Appendix B's rules given to the model, transcribed verbatim. */
/**
 * Appendix B's rules given to the model, transcribed — minus what phase 4 took
 * out of the context.
 *
 * "habits" and "tasks" leave the never-invent clause and the `mouth` bias goes
 * with the mouth: neither slice is in the payload any more, so a rule naming
 * them describes context the model was never given. `signal: task` is still
 * classified — the utterance is worth recording — it simply no longer proposes
 * anything to do about it.
 */
const RULES =
  'nulls over guesses; signal always set (note when unsure); never invent people or ' +
  'events not present in context; time expressions resolved against now and tz.';

/**
 * Phase 5's nutrition rules, given to the model — the whole of the feature.
 *
 * Extraction is model-side and nowhere else (fence 2): there is no food list,
 * no portion table, no unit parser anywhere in this codebase, and there must
 * never be one. What the app does with the answer is arithmetic; deciding
 * that "two eggs on toast" is about 300 kcal is judgment, and judgment lives
 * here in prose the model reads.
 *
 * Four distinctions carry the feature, and each is a sentence below:
 *
 * - **Whose mouth.** Only the owner's consumption counts. "kids had pizza" is
 *   a real pulse about a real dinner and contributes nothing.
 * - **Stated beats estimated, always.** A number the owner said is copied
 *   verbatim and marked `stated`. The coder never second-guesses it, never
 *   rounds it, never substitutes its own idea of what that meal weighs — the
 *   owner logging "620 kcal" has already done the measuring.
 * - **Recognised but uncountable is `kcal: null`, not a guess.** The buffet
 *   plate nobody could size gets a nutrition block with no number, which is
 *   what puts it in the visible "uncounted" tally rather than silently into
 *   or out of the total.
 * - **Not food at all is no block.** Absent and `kcal: null` are different
 *   facts and the ledger reads them differently.
 *
 * Deliberately NOT gated on the `eating` activity label, or on any domain:
 * the label is for the ledger's own rows, the extraction is unconditional on
 * consumption. A drink at a work dinner is `domain: social` and still food.
 */
/**
 * The correction rules (rev 3), and the distinction that makes them work.
 *
 * `nutrition` is a claim about ONE ITEM the owner consumed. A correction is a
 * claim about a WHOLE DAY, and it is the owner reading their own ledger and
 * saying what the number should be. Without this concept the model had no way
 * to express "friday was 2400" except as "the owner just ate 2400 kcal" —
 * which is exactly what it did, and the 2400 landed on today.
 *
 * **An override and a ratification are the same act.** "friday is 2400, not
 * 1220" and "saturday's 880 estimate is fine" both end with the owner having
 * stated a day's total; the second is not a no-op just because the number
 * agrees with what was already there. Recording both means a ratified day
 * stops being an estimate — which is the whole reason the ledger draws a
 * corrected day differently.
 *
 * **An ambiguous day reference produces nothing.** "that was way more than it
 * says" names no day, and a correction guessed onto the wrong one is worse
 * than no correction: it is silent, wrong, and outranks the arithmetic. Nulls
 * over guesses, applied to the field where a guess does the most damage.
 */
const CORRECTION_RULES =
  'corrections: emit one when the owner asserts what a specific DAY totalled — either ' +
  'overriding what the ledger says ("friday was 2400, not 1220") or ratifying it ' +
  "(\"saturday's 880 estimate is fine\"). Both are the owner stating that day's total; " +
  'record both the same way. One utterance may correct several days — return one entry ' +
  'per day. Resolve the day against now and tz and give it as YYYY-MM-DD. If the ' +
  'utterance names no specific day, or the day it means is ambiguous, return an empty ' +
  'corrections array rather than guessing at one. A correction is about a day total; it ' +
  'is not nutrition for an item, and a pulse may carry both.';

const NUTRITION_RULES =
  'nutrition: fill it whenever the text describes the OWNER consuming food or drink, ' +
  'whatever the domain or activity label — beverages count, alcohol counts. Never for ' +
  "anyone else's consumption (\"kids had pizza\", \"wife's dessert\") — omit nutrition " +
  'entirely there. If the owner states a calorie figure, copy it verbatim with ' +
  'kcalSource "stated" and do not second-guess it; same for a stated protein figure. ' +
  'With no stated figure, give a typical-portion point estimate and mark it "estimated". ' +
  'If the consumption is real but genuinely too vague to size ("ate something at the ' +
  'buffet"), return nutrition with kcal null — recognized, uncounted. Omit nutrition ' +
  'only when the utterance is not about the owner consuming anything.';

const SYSTEM_PROMPT = `You classify one captured utterance (pulse) for Meridian, the way a time-use \
survey's trained coders classify a diary entry — judgment over the utterance and the context you \
are given, never string matching. Respond with strict JSON only, matching exactly this shape — no \
prose, no markdown fences, nothing before or after it:

${OUTPUT_SCHEMA}

An effect carries exactly the keys listed for its type and no others, spelled exactly as written here:

${EFFECT_PAYLOADS}

Rules given to the model: ${RULES}

${NUTRITION_RULES}

${CORRECTION_RULES}`;

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
        // Thinking is ON, at the lowest effort, and that is a correctness fix
        // rather than a quality one.
        //
        // It used to be `{ type: 'disabled' }`, on the reasoning that a
        // classification call needs none. What actually happened is the
        // documented failure mode of disabling it: with nowhere to reason, the
        // model intermittently wrote its reasoning into the VISIBLE text —
        // a prose preamble and a ```json fence — and `parseCoding`'s
        // `JSON.parse` threw, so `codePulse` returned null and the pulse
        // stayed uncoded. Silently, because null is also what a dead network
        // returns. Measured against the real API on three real pulses, six
        // runs each: 12/18 parsed before, 18/18 after.
        //
        // `effort: 'low'` keeps it cheap — the thinking replaces the preamble
        // it was already paying for, so average output tokens did not move
        // (189 -> 186). Do not "simplify" this back to disabled.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
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
    nutrition: toNutrition(value.nutrition),
    // The journal reader's own validation, reused rather than restated: the
    // date's round-trip check is the load-bearing part and two copies would be
    // two places to get it wrong.
    corrections: parseCorrections(value.corrections),
    // Stamped, never read off the response. The rev describes the schema THIS
    // build parses against, which is a fact about the code and not about the
    // answer — and a model that echoed `1` (or omitted the key, or wrote
    // "two") would leave the pulse permanently in the backfill's sights, to
    // be re-coded and re-billed on every run. It is in the prompt's schema so
    // the transcription of Appendix B stays faithful; it is ignored here so
    // the loop terminates.
    coderRev: CODER_REV,
    effects: toEffects(value.effects),
    vocabProposal: toVocabProposal(value.vocabProposal),
  };
}

/**
 * The coder's `nutrition`, or `null` for an utterance it said nothing about.
 *
 * Absent, malformed and explicitly null all collapse to `null` — "no
 * nutrition block" — and the one thing that survives is a block the model
 * really wrote. Inside a real block, a missing or unreadable `kcal` becomes
 * `null` rather than dropping the block: that is exactly the
 * recognised-but-uncountable case the rules ask for, and turning it into "not
 * food" would hide a meal instead of counting it as uncounted.
 *
 * A number that is not finite, or negative, is not a calorie count. It reads
 * as uncounted rather than as zero — zero would be a claim the coder never
 * made, and would drag a day's total down silently.
 */
function toNutrition(value: unknown): PulseNutrition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;

  const nutrition: PulseNutrition = {
    kcal: nonNegativeNumber(obj.kcal),
    kcalSource: nutritionSource(obj.kcalSource),
  };
  const proteinG = nonNegativeNumber(obj.proteinG);
  if (proteinG !== null) {
    nutrition.proteinG = proteinG;
    nutrition.proteinSource = nutritionSource(obj.proteinSource);
  }
  return nutrition;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * `estimated` is the fallback, and the direction matters: calling the coder's
 * own guess "stated" would dress a guess up as the owner's measurement, which
 * is the one error this field exists to prevent.
 */
function nutritionSource(value: unknown): NutritionSource {
  return value === 'stated' ? 'stated' : 'estimated';
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
  if (typeof value !== 'object' || value === null) return { eventId: null };
  return { eventId: nullableString((value as Record<string, unknown>).eventId) };
}

function toEffects(value: unknown): PulseEffect[] {
  if (!Array.isArray(value)) return [];
  const effects: PulseEffect[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const type = (item as Record<string, unknown>).type;
    // A retired type (`completeHabit`, `spawnTask`, `updateTask`) is dropped
    // right here and nothing else happens: the prompt no longer offers it, but
    // a prompt is not a schema, and a hallucinated retirement is not an error.
    if (typeof type === 'string' && (EFFECT_TYPES as readonly string[]).includes(type)) {
      effects.push(item as PulseEffect);
    }
  }
  return effects;
}

function toVocabProposal(value: unknown): PulseVocabProposal | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== 'string' || !(VOCAB_PROPOSAL_KINDS as readonly string[]).includes(kind)) return null;
  const proposalValue = obj.value;
  if (typeof proposalValue !== 'string') return null;
  return { kind: kind as PulseVocabProposalKind, value: proposalValue, mapsTo: nullableString(obj.mapsTo) };
}
