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
import { CODER_MODEL, codePulse } from './coder';
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
    for (const key of ['signal', 'domain', 'activity', 'people', 'span', 'links', 'effects', 'vocabProposal']) {
      expect(system).toContain(`"${key}"`);
    }
  });

});
