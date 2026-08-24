/**
 * BackupStatus.
 *
 * The failure states are the whole point of the component, so they are what
 * this covers: red survives a re-render, a re-mount and a genuine reload, the
 * reason survives with it, a rate limit never blames a good token and its wait
 * runs down, being offline is not an alarm, a failing push says so at once
 * rather than at the next poll, a retry with nothing to push resolves the red
 * instead of re-publishing it — and the line itself never reports work in
 * progress, in any state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

interface CapturedFailure {
  kind: string | null;
  retryAfterMs: number | null;
}

const mocks = vi.hoisted(() => ({
  flushOutbox: vi.fn(),
  listJournal: vi.fn(),
  /** Whatever the transport's push path is currently reporting to. */
  pushWatchers: new Set<(failure: { kind: string | null; retryAfterMs: number | null }) => void>(),
}));

vi.mock('../lib/sync', () => ({
  flushOutbox: mocks.flushOutbox,
}));

vi.mock('../lib/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/github')>();
  return {
    ...actual,
    listJournal: mocks.listJournal,
    onPushFailure: (watcher: (failure: CapturedFailure) => void) => {
      mocks.pushWatchers.add(watcher);
      return () => mocks.pushWatchers.delete(watcher);
    },
  };
});

const TOKEN = 'test-token-not-a-real-pat';
const FIVE_MINUTES_MS = 5 * 60_000;
const THREE_HOURS_MS = 3 * 3_600_000;

/** The exact sentences the line is allowed to say. A progress message is not one. */
const LINE = {
  unconfigured: 'backup not set up yet — add a github token in settings.',
  nothingYet: 'nothing backed up from this device yet.',
  fiveMinutes: 'last backed up 5 minutes ago from this device.',
  now: 'last backed up now from this device.',
  noReason: 'backup failed — the last push did not reach github.',
  perPath: 'backup failed — something went wrong on the last push.',
  auth: 'backup failed — github rejected the token. check or replace the pat in settings.',
  offline: 'not backed up — no connection. it will catch up.',
};

const STATE_ERROR = 'local copy not saved — this browser refused the write. the queued edits are still safe.';

/** Anything drawn as work-in-progress. The text form is checked against LINE above. */
const SPINNER_SELECTOR = '[role="progressbar"], [aria-busy="true"], [class*="animate-"]';

type Db = typeof import('../lib/db');
type View = ReturnType<typeof render>;

/**
 * A fresh module registry per test: the component's store deliberately outlives
 * its mount, so it has to outlive nothing else.
 */
async function freshDb(): Promise<Db> {
  vi.resetModules();
  const db = await import('../lib/db');
  await db.deleteMeta('token');
  await db.deleteMeta('lastBackupAt');
  await db.deleteMeta('lastBackupError');
  await db.deleteMeta('lastBackupErrorKind');
  await db.deleteMeta('lastStateError');
  return db;
}

async function mountStatus() {
  const { BackupStatus } = await import('./BackupStatus');
  const view = render(<BackupStatus />);
  await waitFor(() => expect(view.container.textContent).not.toBe(''));
  return { ...view, BackupStatus };
}

function statusText(): string {
  return document.body.textContent ?? '';
}

/** The sentence the line leads with — the one the owner reads first. */
function statusSentence(view: View): string {
  return view.container.querySelector('span')?.textContent ?? '';
}

function expectNothingDrawnAsBusy(view: View): void {
  expect(view.container.querySelector(SPINNER_SELECTOR)).toBeNull();
}

/** What `github.ts` tells its watchers the moment a push fails. */
function reportPushFailure(kind: string | null, retryAfterMs: number | null = null): void {
  act(() => {
    for (const watcher of mocks.pushWatchers) watcher({ kind, retryAfterMs });
  });
}

/** A stored token plus a recorded failure: the state the owner opens the app in. */
async function seedFailure(db: Db, kind?: string): Promise<void> {
  await db.setToken(TOKEN);
  await db.setMeta('lastBackupError', 'the push failed');
  if (kind !== undefined) await db.setMeta('lastBackupErrorKind', kind);
}

/** A retry whose flush is still running, and the handle that lets it finish. */
function hangingFlush(): () => void {
  let settle = (): void => undefined;
  mocks.flushOutbox.mockReturnValue(
    new Promise((resolve) => {
      settle = () => resolve({ pushed: 1, remaining: 0, error: null });
    }),
  );
  return () => settle();
}

beforeEach(() => {
  mocks.flushOutbox.mockReset();
  mocks.listJournal.mockReset();
  mocks.pushWatchers.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BackupStatus', () => {
  it('renders a relative time once a backup has succeeded', async () => {
    const db = await freshDb();
    await db.setToken(TOKEN);
    await db.setMeta('lastBackupAt', Date.now() - FIVE_MINUTES_MS);

    const view = await mountStatus();

    await waitFor(() => expect(statusSentence(view)).toBe(LINE.fiveMinutes));
    expect(screen.queryByRole('button', { name: 'retry' })).toBeNull();
  });

  it('never claims a backup that has not happened yet', async () => {
    const db = await freshDb();
    await db.setToken(TOKEN);
    // A device whose clock runs fast — a documented limitation of this system,
    // so a reachable one. "last backed up in 3 hours" is not a thing to say.
    await db.setMeta('lastBackupAt', Date.now() + THREE_HOURS_MS);

    const view = await mountStatus();

    await waitFor(() => expect(statusSentence(view)).toBe(LINE.now));
    expect(statusText()).not.toContain('in 3 hours');
  });

  it('keeps a failure red across a re-render and a re-mount', async () => {
    const db = await freshDb();
    await seedFailure(db);

    const view = await mountStatus();
    const { BackupStatus } = view;

    await waitFor(() => expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument());
    const redAtFirst = view.container.querySelector('.text-error');
    expect(redAtFirst).not.toBeNull();

    // A re-render must not reset it.
    view.rerender(<BackupStatus />);
    expect(view.container.querySelector('.text-error')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();

    // Neither must a re-mount: the failure lives outside the component.
    view.unmount();
    const remounted = render(<BackupStatus />);
    await waitFor(() => expect(remounted.container.querySelector('.text-error')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
  });

  it('reads the reason back after a reload, not only after a re-mount', async () => {
    const db = await freshDb();
    await seedFailure(db, 'network');

    // A force-quit and reopen, which a re-mount is not: a fresh module registry
    // drops the in-memory snapshot exactly as reloading the page does. The
    // reason has to come back out of the store, or a phone that lost signal
    // reopens to the alarm instead of "it will catch up".
    vi.resetModules();
    const view = await mountStatus();

    await waitFor(() => expect(statusSentence(view)).toBe(LINE.offline));
    expect(view.container.querySelector('.text-error')).toBeNull();
  });

  it('points at the token only when GitHub rejected it', async () => {
    const db = await freshDb();
    await seedFailure(db, 'auth');

    const view = await mountStatus();

    await waitFor(() => expect(statusSentence(view)).toBe(LINE.auth));
    expect(statusText()).not.toContain('the token is fine');
    expect(view.container.querySelector('.text-error')).not.toBeNull();
  });

  it('reads being offline as normal rather than as an alarm', async () => {
    const db = await freshDb();
    await db.setToken(TOKEN);
    const view = await mountStatus();

    reportPushFailure('network');

    expect(statusSentence(view)).toBe(LINE.offline);
    expect(view.container.querySelector('.text-error')).toBeNull();
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
  });

  it('goes red the moment a push fails, without waiting for the next poll', async () => {
    const db = await freshDb();
    await db.setToken(TOKEN);
    await db.setMeta('lastBackupAt', Date.now() - FIVE_MINUTES_MS);
    const view = await mountStatus();
    await waitFor(() => expect(statusSentence(view)).toBe(LINE.fiveMinutes));

    // No timer advanced, no store re-read: the push path said so itself.
    reportPushFailure('auth');

    expect(statusSentence(view)).toBe(LINE.auth);
    expect(view.container.querySelector('.text-error')).not.toBeNull();
  });

  it('keeps the age of the last durable copy visible while a push is failing', async () => {
    const db = await freshDb();
    await seedFailure(db, 'auth');
    await db.setMeta('lastBackupAt', Date.now() - FIVE_MINUTES_MS);

    const view = await mountStatus();

    // Five minutes old and three weeks old are different emergencies, and the
    // failure line alone cannot tell them apart.
    await waitFor(() => expect(statusSentence(view)).toBe(LINE.auth));
    expect(statusText()).toContain(LINE.fiveMinutes);
  });

  it('reports a rate limit as a wait that runs down, never as a bad token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-24T09:00:00.000Z'));
    const db = await freshDb();
    await seedFailure(db, 'ratelimit');

    const view = await mountStatus();
    reportPushFailure('ratelimit', 2 * 60_000);

    expect(statusText()).toContain('the token is fine');
    expect(statusText()).toContain('in 2 minutes');
    expect(statusText()).not.toContain('pat');
    expect(statusText()).not.toContain('rejected');

    // Ten minutes on the wait is long over. A frozen duration would still be
    // promising "in 2 minutes"; a deadline knows it has passed.
    view.unmount();
    vi.setSystemTime(new Date('2026-08-24T09:10:00.000Z'));
    const later = await mountStatus();

    await waitFor(() => expect(statusText()).toContain('try again now'));
    expect(statusText()).not.toContain('in 2 minutes');
    expect(later.container.querySelector('.text-error')).not.toBeNull();
  });

  it('treats a never-configured device as a prompt, not a failure', async () => {
    await freshDb();

    const view = await mountStatus();

    await waitFor(() => expect(statusSentence(view)).toBe(LINE.unconfigured));
    expect(view.container.querySelector('.text-error')).toBeNull();
    expect(screen.queryByRole('button', { name: 'retry' })).toBeNull();
    // Nothing was asked of the network to work that out.
    expect(mocks.flushOutbox).not.toHaveBeenCalled();
    expect(mocks.listJournal).not.toHaveBeenCalled();
  });

  it('states a fact in every state, including while a retry is in flight', async () => {
    const db = await freshDb();
    let view = await mountStatus();
    await waitFor(() => expect(statusSentence(view)).toBe(LINE.unconfigured));
    expectNothingDrawnAsBusy(view);
    cleanup();

    await db.setToken(TOKEN);
    await db.setMeta('lastBackupAt', Date.now() - FIVE_MINUTES_MS);
    view = await mountStatus();
    await waitFor(() => expect(statusSentence(view)).toBe(LINE.fiveMinutes));
    expectNothingDrawnAsBusy(view);
    cleanup();

    await db.setMeta('lastBackupError', 'the push failed');
    view = await mountStatus();
    await waitFor(() => expect(statusSentence(view)).toBe(LINE.noReason));
    expectNothingDrawnAsBusy(view);

    // A retry is exactly where a spinner would be tempting. The control
    // acknowledges its own click — the house pattern, a disabled button with
    // changed text — and the line goes on saying where the data stands.
    const settle = hangingFlush();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(statusSentence(view)).toBe(LINE.noReason);
    expectNothingDrawnAsBusy(view);

    // And a microtask later, which is where the first await lands and where a
    // spinner asserted synchronously would have been invisible.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(statusSentence(view)).toBe(LINE.noReason);
    expectNothingDrawnAsBusy(view);
    expect(screen.getByRole('button', { name: 'retrying...' })).toBeDisabled();

    settle();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'retrying...' })).toBeNull());
  });

  it('acknowledges a retry and does not start a second one under it', async () => {
    const db = await freshDb();
    await seedFailure(db);
    await mountStatus();
    await waitFor(() => expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument());

    const settle = hangingFlush();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    const inFlight = screen.getByRole('button', { name: 'retrying...' });
    expect(inFlight).toBeDisabled();
    fireEvent.click(inFlight);
    expect(mocks.flushOutbox).toHaveBeenCalledTimes(1);

    settle();
    await waitFor(() => expect(mocks.flushOutbox).toHaveBeenCalledTimes(1));
  });

  it('keeps a per-path failure red and never re-guesses the reason', async () => {
    const db = await freshDb();
    await seedFailure(db, 'http');
    await db.setMeta('lastBackupAt', Date.now() - FIVE_MINUTES_MS);
    const view = await mountStatus();
    await waitFor(() => expect(statusSentence(view)).toBe(LINE.perPath));

    // One file over the size limit fails permanently while the rest go. If the
    // reason were re-derived from a fresh request, a dropped connection a
    // second later would relabel this "no connection. it will catch up." — a
    // calm sentence about something that will never catch up on its own.
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    mocks.flushOutbox.mockResolvedValue({ pushed: 1, remaining: 2, error: 'GitHub said no' });
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'retry' })).toBeEnabled());

    expect(statusSentence(view)).toBe(LINE.perPath);
    expect(statusText()).not.toContain('no connection');
    expect(statusText()).toContain(LINE.fiveMinutes);
    // The retry costs the flush and nothing else.
    expect(mocks.listJournal).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('lets a retry with nothing to push clear the red for good', async () => {
    const db = await freshDb();
    await seedFailure(db, 'http');
    await db.setMeta('lastBackupAt', Date.now() - FIVE_MINUTES_MS);
    const view = await mountStatus();
    await waitFor(() => expect(view.container.querySelector('.text-error')).not.toBeNull());

    // An empty outbox pushes nothing, so nothing can clear the note — and the
    // red would outlive the problem forever, one useless click at a time.
    mocks.flushOutbox.mockResolvedValue({ pushed: 0, remaining: 0, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => expect(statusSentence(view)).toBe(LINE.fiveMinutes));
    expect(view.container.querySelector('.text-error')).toBeNull();
    expect(screen.queryByRole('button', { name: 'retry' })).toBeNull();
    // Cleared in the store too, or the next open is red again.
    expect(await db.getMeta<string>('lastBackupError')).toBeUndefined();
    expect(await db.getMeta<string>('lastBackupErrorKind')).toBeUndefined();
  });

  it('reports a failed local save without calling it a failed backup', async () => {
    const db = await freshDb();
    await db.setToken(TOKEN);
    await db.setMeta('lastBackupAt', Date.now() - FIVE_MINUTES_MS);
    await db.setMeta('lastStateError', 'the cached state could not be saved: the quota is exhausted');

    const view = await mountStatus();

    // The push is fine; this browser has stopped keeping its own copy.
    await waitFor(() => expect(statusText()).toContain(STATE_ERROR));
    expect(statusSentence(view)).toBe(LINE.fiveMinutes);
    expect(statusText()).not.toContain('backup failed');
    expect(screen.queryByRole('button', { name: 'retry' })).toBeNull();
  });

  it('shows a failed push and a failed local save as two separate things', async () => {
    const db = await freshDb();
    await seedFailure(db, 'auth');
    await db.setMeta('lastStateError', 'the cached state could not be saved: the quota is exhausted');

    const view = await mountStatus();

    await waitFor(() => expect(statusSentence(view)).toBe(LINE.auth));
    expect(statusText()).toContain(STATE_ERROR);
  });

  it('clears only the backup signal when a retry finds nothing to push', async () => {
    const db = await freshDb();
    await seedFailure(db, 'http');
    await db.setMeta('lastStateError', 'the cached state could not be saved: the quota is exhausted');
    const view = await mountStatus();
    await waitFor(() => expect(statusSentence(view)).toBe(LINE.perPath));

    mocks.flushOutbox.mockResolvedValue({ pushed: 0, remaining: 0, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => expect(statusSentence(view)).toBe(LINE.nothingYet));
    // A push that lands says nothing about whether this browser can save.
    expect(statusText()).toContain(STATE_ERROR);
    expect(await db.getMeta<string>('lastStateError')).toEqual(expect.any(String));
    expect(await db.getMeta<string>('lastBackupError')).toBeUndefined();
  });
});
