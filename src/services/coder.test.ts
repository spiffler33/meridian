/**
 * codePulse: the request shape, and fence 2 — every failure, of any shape,
 * collapses to `null`. Nothing here classifies pulse text; the only thing
 * under test on a failure path is that `codePulse` gives back `null` and
 * touches nothing else. `loadApiKey` (claude.ts, reused as-is) is exercised
 * for real against fake-indexeddb rather than mocked, since it is the one
 * seam this file borrows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearApiKey, clearApiKeyCache, saveApiKey } from './claude';
import { closeDb } from '../lib/db';
import { CODER_MODEL, CODER_REV, codePulse } from './coder';
import type { CoderContext } from './coder';

const BASE_CONTEXT: CoderContext = {
  now: '2026-08-28T12:00:00.000Z',
  tz: 'America/Los_Angeles',
  vocab: { domains: ['db', 'self'], activities: { gym: 'self' }, people: ['wife'] },
  todayEvents: [],
  recentPulses: [],
};

function textResponse(json: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }),
  } as Response;
}

const VALID_CODING_JSON = {
  signal: 'note',
  domain: null,
  activity: null,
  people: [],
  span: { start: '2026-08-28T12:00:00.000Z', end: null, approx: false },
  links: { eventId: null },
  nutrition: null,
  coderRev: 2,
  effects: [],
  vocabProposal: null,
};

beforeEach(async () => {
  await saveApiKey('test-key-not-real');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  clearApiKeyCache();
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('meridian');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
    request.onblocked = () => reject(new Error('deleteDatabase was blocked: a test leaked a connection'));
  });
});

describe('codePulse — request shape', () => {
  it('sends CODER_MODEL, a capped max_tokens, thinking disabled, and text+context as the user message', async () => {
    const fetchMock = vi.fn(async () => textResponse(VALID_CODING_JSON));
    vi.stubGlobal('fetch', fetchMock);

    await codePulse('wrote the plan', BASE_CONTEXT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': 'test-key-not-real',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(CODER_MODEL);
    expect(body.max_tokens).toBeLessThanOrEqual(500);
    // Disabled: a classification call needs no reasoning, and reasoning would
    // compete with a tight token ceiling meant entirely for the answer.
    expect(body.thinking).toEqual({ type: 'disabled' });

    const payload = JSON.parse(body.messages[0].content);
    expect(payload).toEqual({ text: 'wrote the plan', ...BASE_CONTEXT });

    // Aborted at the same 30 s ceiling as the GitHub write: one connection
    // that hangs rather than fails must not wedge every pulse behind it in
    // the sweep until the tab is reloaded.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null without a network call when no API key is stored', async () => {
    await clearApiKey();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('codePulse — every failure collapses to null, no error taxonomy (fence 2)', () => {
  it('a network throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });

  it('a non-2xx response — a 401 gets no special handling, same as any other failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({}, { ok: false, status: 401 })));
    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });

  it('a response the model ran out of room to finish (stop_reason: max_tokens)', async () => {
    // Truncated JSON fails JSON.parse anyway, but only by luck — and a
    // truncation that happened to parse would look like a usable coding. The
    // stop reason is machine-defined, so reading it is not a rule over text.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          stop_reason: 'max_tokens',
          content: [{ type: 'text', text: JSON.stringify(VALID_CODING_JSON) }],
        }),
      }))
    );

    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });

  it('a 429 gets no special handling either — no retry ladder exists to test', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({}, { ok: false, status: 429 })));
    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });

  it('a response body that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError('not json');
            },
          }) as unknown as Response
      )
    );
    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });

  it('no text content block in the response (e.g. a refusal, or thinking-only content)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ content: [{ type: 'thinking', thinking: '...' }] }),
          }) as unknown as Response
      )
    );
    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });

  it('text that is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ content: [{ type: 'text', text: 'not json {' }] }),
          }) as unknown as Response
      )
    );
    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });

  it('valid JSON with a signal outside the seven the model was given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({ ...VALID_CODING_JSON, signal: 'happy' })));
    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });

  it('valid JSON with no signal at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({ domain: 'self' })));
    expect(await codePulse('x', BASE_CONTEXT)).toBeNull();
  });
});

describe('codePulse — a valid response degrades missing fields to safe defaults, never to a guess', () => {
  it('fills nulls/empties for everything but the signal the model actually gave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({ signal: 'task' })));

    expect(await codePulse('x', BASE_CONTEXT)).toEqual({
      signal: 'task',
      domain: null,
      activity: null,
      people: [],
      // Appendix A: "start defaults to `ts`", which `now` carries. Never '':
      // an empty start round-trips into a journal nothing may ever compact,
      // and phase 3 reads span.start straight into a Date.
      span: { start: BASE_CONTEXT.now, end: null, approx: false },
      links: { eventId: null },
      // A response that says nothing about food is a response about something
      // that is not food. `null` here, rather than an empty block, is what
      // makes a re-code able to CLEAR one an earlier revision wrote.
      nutrition: null,
      coderRev: CODER_REV,
      effects: [],
      vocabProposal: null,
    });
  });

  it("defaults an empty-string start to the pulse's own instant too, not just an absent span", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => textResponse({ signal: 'note', span: { start: '', end: null, approx: false } }))
    );

    expect((await codePulse('x', BASE_CONTEXT))?.span).toEqual({
      start: BASE_CONTEXT.now,
      end: null,
      approx: false,
    });
  });

  it('keeps a start the model did give — the default is a fallback, not an override', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        textResponse({ signal: 'block', span: { start: '2026-08-28T06:00:00.000Z', end: null, approx: true } })
      )
    );

    expect((await codePulse('x', BASE_CONTEXT))?.span).toEqual({
      start: '2026-08-28T06:00:00.000Z',
      end: null,
      approx: true,
    });
  });

  it('drops an effect whose type Appendix C does not name, retired ones included', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      textResponse({
        ...VALID_CODING_JSON,
        effects: [
          { type: 'claimEvent', eventId: 'evt-1' },
          { type: 'deleteEverything' },
          // Retired in phase 4. The prompt no longer offers it, but a prompt is
          // not a schema: dropping it silently is the whole handling.
          { type: 'spawnTask', text: 'call the plumber' },
        ],
      })
    ));

    const result = await codePulse('x', BASE_CONTEXT);
    expect(result?.effects).toEqual([{ type: 'claimEvent', eventId: 'evt-1' }]);
  });

  it('returns the full coding on a well-formed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse(VALID_CODING_JSON)));
    expect(await codePulse('x', BASE_CONTEXT)).toEqual(VALID_CODING_JSON);
  });
});

/**
 * The system prompt.
 *
 * It is the only place the model is ever told what an effect carries or what
 * the tower mouth means, and the chip code reads exact keys with no fallback:
 * a coding answering `habit_id` renders a chip whose tap writes nothing and
 * then drops the proposal. Matching a variant spelling in the chip code is a
 * string rule over the model's output — the same fence as one over the owner's
 * text — so the prompt is where this can be fixed, and therefore where it has
 * to be pinned. Read off the wire rather than off an export: what the model is
 * sent is the contract, not what a constant happens to hold.
 */
describe('the system prompt — the only place the model is told any of this', () => {
  async function systemPrompt(context: CoderContext = BASE_CONTEXT): Promise<string> {
    const fetchMock = vi.fn(async () => textResponse(VALID_CODING_JSON));
    vi.stubGlobal('fetch', fetchMock);
    await codePulse('the landlord is fixing the boiler', context);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    return JSON.parse(calls[0][1].body as string).system as string;
  }

  it('names every effect type and every payload key the chips actually read', async () => {
    const system = await systemPrompt();

    // The surviving Appendix C effect, and the exact key `applyOneEffect`
    // reads off it. Add a key to the chip code without adding it here and this
    // fails, which is the point.
    expect(system).toContain('claimEvent');
    expect(system).toContain('"eventId"');
  });

  it('names none of the effects phase 4 retired, and nothing about habits or tasks', async () => {
    const system = await systemPrompt();

    // Asserted as absence. Fence 9 is a claim about what the model is told as
    // much as about what the app does with the answer, and the prompt is the
    // only place that claim can be checked.
    for (const gone of ['completeHabit', 'spawnTask', 'updateTask', 'todayHabits', 'openTowerItems', 'mouth']) {
      expect(system).not.toContain(gone);
    }
  });

  it('tells the model the shape it must answer in, and the seven signals', async () => {
    const system = await systemPrompt();

    expect(system).toContain('block|event|state|plan|task|claim|note');
    for (const key of ['signal', 'domain', 'activity', 'people', 'span', 'links', 'nutrition', 'coderRev', 'effects', 'vocabProposal']) {
      expect(system).toContain(`"${key}"`);
    }
  });

  it('carries the four nutrition distinctions the feature rests on — the extraction lives here or nowhere', async () => {
    const system = await systemPrompt();

    // Whose mouth, stated-beats-estimated, uncountable-is-null, and the shape
    // of the answer. If any of these leaves the prompt the feature quietly
    // becomes something else, and no other test would notice.
    expect(system).toContain('OWNER consuming');
    expect(system).toContain('kcalSource "stated"');
    expect(system).toContain('kcal null');
    expect(system).toContain('typical-portion point estimate');
  });

  it('does not gate nutrition on the eating label — Appendix B says the text already carries everything', async () => {
    const system = await systemPrompt();
    // The label is for the ledger's own rows. A drink at a work dinner is
    // `domain: social` and still food, and this sentence is what says so.
    expect(system).toContain('whatever the domain or activity label');
  });

  it('sends no new context slice for nutrition — the allowlist did not grow (fence 5)', async () => {
    const fetchMock = vi.fn(async () => textResponse(VALID_CODING_JSON));
    vi.stubGlobal('fetch', fetchMock);
    await codePulse('two eggs on toast', BASE_CONTEXT);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const payload = JSON.parse(JSON.parse(calls[0][1].body as string).messages[0].content as string);

    // Appendix B's own sentence, made checkable: the nutrition feature adds
    // nothing to the payload. A future session "helpfully" attaching a food
    // log, a weight, or yesterday's totals fails right here.
    expect(Object.keys(payload).sort()).toEqual(
      ['now', 'recentPulses', 'text', 'todayEvents', 'tz', 'vocab'].sort()
    );
  });

});

/**
 * The nutrition half of the contract (phase 5).
 *
 * Every case here is a fixture of what the MODEL answered, put through the
 * parser — never a test that the model gets it right, which only a live call
 * and Gate 5's calibration week can say. What is pinned is that each of the
 * four states the rules ask for survives the trip into a row, distinctly:
 * stated, estimated, recognised-but-uncountable, and not-food.
 *
 * There is no extraction logic here to test. There is no food list, no
 * portion table, no unit parser anywhere in this codebase and there must
 * never be one (fence 2) — deciding a plate's size is judgment, and the only
 * thing on this side of the wire is arithmetic on the answer.
 */
describe('codePulse — nutrition', () => {
  async function nutritionOf(json: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({ signal: 'note', ...json })));
    return (await codePulse('x', BASE_CONTEXT))?.nutrition;
  }

  it('keeps a stated calorie figure verbatim, marked as the owner\'s own', async () => {
    // "620 kcal burrito". The owner has already done the measuring; the coder
    // copying it is the whole rule, and nothing downstream may round it.
    expect(await nutritionOf({ nutrition: { kcal: 620, kcalSource: 'stated' } })).toEqual({
      kcal: 620,
      kcalSource: 'stated',
    });
  });

  it('keeps stated calories and stated protein together, each with its own provenance', async () => {
    expect(
      await nutritionOf({
        nutrition: { kcal: 620, kcalSource: 'stated', proteinG: 42, proteinSource: 'stated' },
      })
    ).toEqual({ kcal: 620, kcalSource: 'stated', proteinG: 42, proteinSource: 'stated' });
  });

  it('carries an estimate through as an estimate, so the ledger can show what it rests on', async () => {
    // "two eggs on toast" — a number the coder produced, not one the owner said.
    expect(await nutritionOf({ nutrition: { kcal: 300, kcalSource: 'estimated' } })).toEqual({
      kcal: 300,
      kcalSource: 'estimated',
    });
  });

  it('carries an estimated drink through the same way — alcohol is food (a beverage counts)', async () => {
    expect(await nutritionOf({ nutrition: { kcal: 180, kcalSource: 'estimated' } })).toEqual({
      kcal: 180,
      kcalSource: 'estimated',
    });
  });

  it('keeps a vague meal as recognised-but-uncounted rather than dropping it or guessing at it', async () => {
    // "ate something at the buffet". `kcal: null` is what puts this in the
    // visible uncounted tally; a zero would drag the day's total down while
    // looking like a total, which is the failure this state exists to prevent.
    expect(await nutritionOf({ nutrition: { kcal: null, kcalSource: 'estimated' } })).toEqual({
      kcal: null,
      kcalSource: 'estimated',
    });
  });

  it("returns null for someone else's food — an omitted block is the not-food answer", async () => {
    // "kids had pizza" is a real pulse about a real dinner and contributes
    // nothing. Absent and `kcal: null` are different facts; this is absent.
    expect(await nutritionOf({})).toBeNull();
    expect(await nutritionOf({ nutrition: null })).toBeNull();
  });

  it('reads a nonsense figure as uncounted rather than as zero calories', async () => {
    // A guess the app makes on the model's behalf is still a guess. Uncounted
    // is visible; a silent zero is a day that reads lighter than it was.
    expect(await nutritionOf({ nutrition: { kcal: 'lots', kcalSource: 'stated' } })).toEqual({
      kcal: null,
      kcalSource: 'stated',
    });
    expect(await nutritionOf({ nutrition: { kcal: -50, kcalSource: 'estimated' } })).toEqual({
      kcal: null,
      kcalSource: 'estimated',
    });
  });

  it('calls an unreadable provenance an estimate, never the owner\'s own figure', async () => {
    // The safe direction: dressing the coder's guess up as the owner's
    // measurement is the one error this field exists to prevent.
    expect(await nutritionOf({ nutrition: { kcal: 400 } })).toEqual({ kcal: 400, kcalSource: 'estimated' });
    expect(await nutritionOf({ nutrition: { kcal: 400, kcalSource: 'measured' } })).toEqual({
      kcal: 400,
      kcalSource: 'estimated',
    });
  });

  it('stamps the build\'s own coderRev and ignores whatever the model claimed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse({ signal: 'note', coderRev: 1 })));
    // A model echoing an older rev would leave the pulse permanently in the
    // backfill's sights — re-coded, and re-billed, on every single run.
    expect((await codePulse('x', BASE_CONTEXT))?.coderRev).toBe(CODER_REV);
  });
});
