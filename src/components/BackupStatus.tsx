/**
 * Backup status.
 *
 * The one line that says whether this device's data has actually reached
 * GitHub. It renders from IndexedDB and never waits on the network, and a
 * failure stays visible until a push genuinely succeeds — the failure lives in
 * the store below rather than in component state, so a re-mount cannot clear
 * it, and both the failure and its reason are read back out of IndexedDB, so
 * neither can a reload. Silent failure is the bug this exists to prevent, so
 * the line itself never reports work in progress: it states what is true now,
 * and the age of the last durable copy stays visible while something is wrong.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { deleteMeta, getMeta, getToken } from '../lib/db';
import { relativeTime } from '../utils/dates';
import { onPushFailure } from '../lib/github';
import type { GitHubErrorKind } from '../lib/github';
import { flushOutbox } from '../lib/sync';

/** How often the line re-reads the store, and re-renders so the clock moves. */
const REFRESH_MS = 30_000;

/**
 * A local write that failed is a separate signal from a push that failed: the
 * events are still queued and will still reach GitHub, but this browser has
 * stopped keeping its own copy, and that only ever gets worse quietly.
 */
const STATE_ERROR_TEXT =
  'local copy not saved — this browser refused the write. the queued edits are still safe.';

// ============================================================================
// Store — module-level on purpose: a red state must outlive the component
// ============================================================================

/** `unconfigured` is a device with no token. That is not a failure. */
type BackupHealth = 'unconfigured' | 'ok' | 'failed';

interface BackupSnapshot {
  health: BackupHealth;
  /** When a push last reached GitHub, or null if none ever has. */
  lastBackupAt: number | null;
  /** Why the last push failed, when GitHub itself said. Null means only that it failed. */
  kind: GitHubErrorKind | null;
  /** When GitHub's rate limit lifts, as a time rather than a duration. */
  retryUntil: number | null;
  /** This browser could not save its own copy. Not a backup failure. */
  stateFailed: boolean;
  /** A retry the owner asked for is still running. */
  retrying: boolean;
}

let snapshot: BackupSnapshot = {
  health: 'unconfigured',
  lastBackupAt: null,
  kind: null,
  retryUntil: null,
  stateFailed: false,
  retrying: false,
};

const listeners = new Set<() => void>();

function readSnapshot(): BackupSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: BackupSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

const KINDS: GitHubErrorKind[] = ['auth', 'ratelimit', 'conflict', 'network', 'http'];

/** The stored kind, or null. The store outlives any one version of this file. */
function asKind(value: unknown): GitHubErrorKind | null {
  return KINDS.includes(value as GitHubErrorKind) ? (value as GitHubErrorKind) : null;
}

/**
 * Re-read the store. `lastBackupError` is written by the push path and removed
 * only by a push that GitHub accepted, so it — not anything held in memory — is
 * what makes the red state survive a reload. `lastBackupErrorKind` is read the
 * same way: a phone that lost signal, was force-quit and reopened must still
 * read as "no connection", not as the generic alarm.
 */
async function refresh(): Promise<void> {
  const [configured, lastBackupAt, failure, storedKind, stateError] = await Promise.all([
    getToken().then(Boolean),
    getMeta<number>('lastBackupAt'),
    getMeta<string>('lastBackupError'),
    getMeta<unknown>('lastBackupErrorKind'),
    getMeta<string>('lastStateError'),
  ]);
  const failed = failure !== undefined;
  publish({
    ...snapshot,
    health: !configured ? 'unconfigured' : failed ? 'failed' : 'ok',
    lastBackupAt: typeof lastBackupAt === 'number' ? lastBackupAt : null,
    kind: failed ? asKind(storedKind) : null,
    // A deadline GitHub gave us is session knowledge; it goes when the failure
    // it explains does, and a reload simply falls back to "shortly".
    retryUntil: failed ? snapshot.retryUntil : null,
    stateFailed: stateError !== undefined,
  });
}

/**
 * A failing push says so here, at the moment it fails.
 *
 * The poll below is a clock, not a smoke alarm: waiting for it would leave the
 * owner reading "backed up" for most of a minute after their data stopped
 * arriving. The store's own note lands moments later and the next refresh
 * reconciles against it; this only makes the red immediate.
 */
onPushFailure((failure) => {
  publish({
    ...snapshot,
    health: 'failed',
    kind: failure.kind,
    retryUntil: failure.retryAfterMs === null ? null : Date.now() + failure.retryAfterMs,
  });
});

/** Push whatever is queued. Never throws: the outcome lands in the status line. */
async function retryBackup(): Promise<void> {
  if (snapshot.retrying) return;
  publish({ ...snapshot, retrying: true });
  try {
    const result = await flushOutbox();
    // Nothing queued and nothing refused: there is no unsent event left for the
    // recorded failure to be about. Clearing it in the store — not just here —
    // is what stops a red no future push could ever resolve, since a flush with
    // an empty outbox never clears it and never will.
    if (result !== null && result.error === null && result.pushed === 0 && result.remaining === 0) {
      await deleteMeta('lastBackupError');
      await deleteMeta('lastBackupErrorKind');
    }
    await refresh();
  } catch {
    // The local store itself refused. There is no GitHub reason to report.
    publish({ ...snapshot, health: 'failed', kind: null, retryUntil: null });
  } finally {
    publish({ ...snapshot, retrying: false });
  }
}

// ============================================================================
// Wording
// ============================================================================

/**
 * The age of the last durable copy.
 *
 * Clamped to the present: device clock skew is a known limitation of this
 * system, and a phone running fast would otherwise announce a backup that has
 * not happened — "last backed up in 3 hours".
 */
function backedUpLine(snap: BackupSnapshot, nowMs: number): string {
  if (snap.lastBackupAt === null) return 'nothing backed up from this device yet.';
  return `last backed up ${relativeTime(Math.min(0, snap.lastBackupAt - nowMs))} from this device.`;
}

/**
 * The same fact, whispered. This is what sits under every screen on an
 * ordinary day, so on an ordinary day it is four words in the quietest tier
 * the palette has — the moment there is nothing to do about it, a full
 * sentence with a full stop is the app talking for the sake of it.
 */
function healthyLine(snap: BackupSnapshot, nowMs: number): string {
  if (snap.lastBackupAt === null) return 'not backed up yet';
  return `backed up ${relativeTime(Math.min(0, snap.lastBackupAt - nowMs))}`;
}

interface Line {
  text: string;
  /**
   * How loudly the line speaks. `whisper` is the healthy everyday case and is
   * deliberately below the contrast bar; anything the owner must act on is
   * `normal` or `alarm`.
   */
  tone: 'whisper' | 'normal' | 'alarm';
  /** How old the last durable copy is, kept beside a failure rather than replaced by it. */
  detail: string | null;
  /** Worth the owner's attention. Being offline is not. */
  alarming: boolean;
  retry: boolean;
}

function failureLine(snap: BackupSnapshot, nowMs: number): Omit<Line, 'detail' | 'tone'> {
  switch (snap.kind) {
    case 'auth':
      // The only branch allowed to point at the token.
      return {
        text: 'backup failed — github rejected the token. check or replace the pat in settings.',
        alarming: true,
        retry: true,
      };
    case 'ratelimit': {
      // A deadline, not a frozen duration: ten minutes after a 429 this must
      // not still be promising "in 2 minutes".
      const wait = snap.retryUntil === null ? 'shortly' : relativeTime(Math.max(0, snap.retryUntil - nowMs));
      return {
        text: `backup paused — github's rate limit. the token is fine; try again ${wait}.`,
        alarming: true,
        retry: true,
      };
    }
    case 'network':
      // Expected on a phone. Reads as ordinary, and is not coloured as a fault.
      return { text: 'not backed up — no connection. it will catch up.', alarming: false, retry: true };
    case 'conflict':
    case 'http':
      return { text: 'backup failed — something went wrong on the last push.', alarming: true, retry: true };
    case null:
      return { text: 'backup failed — the last push did not reach github.', alarming: true, retry: true };
  }
}

function statusLine(snap: BackupSnapshot, nowMs: number): Line {
  if (snap.health === 'unconfigured') {
    return {
      text: 'backup not set up yet — add a github token in settings.',
      detail: null,
      tone: 'normal',
      alarming: false,
      retry: false,
    };
  }
  if (snap.health === 'failed') {
    // Whether the last durable copy is five minutes or three weeks old is the
    // difference between an inconvenience and an emergency, so it stays on
    // screen exactly when the owner needs it.
    const failure = failureLine(snap, nowMs);
    return {
      ...failure,
      detail: backedUpLine(snap, nowMs),
      tone: failure.alarming ? 'alarm' : 'normal',
    };
  }
  return { text: healthyLine(snap, nowMs), detail: null, tone: 'whisper', alarming: false, retry: false };
}

// ============================================================================
// Component
// ============================================================================

export function BackupStatus() {
  const snap = useSyncExternalStore(subscribe, readSnapshot);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void refresh().catch(() => undefined);
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh().catch(() => undefined);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const line = statusLine(snap, now);

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${
        line.tone === 'whisper' ? 'text-2xs' : 'text-xs'
      }`}
      aria-live="polite"
    >
      <span
        className={
          line.tone === 'alarm'
            ? 'text-error'
            : line.tone === 'whisper'
              ? 'text-text-faint'
              : 'text-text-muted'
        }
      >
        {line.text}
      </span>
      {line.detail !== null && <span className="text-text-muted">{line.detail}</span>}
      {snap.stateFailed && <span className="text-error">{STATE_ERROR_TEXT}</span>}
      {line.retry && (
        <button
          onClick={() => {
            void retryBackup();
          }}
          disabled={snap.retrying}
          className="text-text-muted hover:text-accent transition-colors disabled:opacity-50"
        >
          {snap.retrying ? 'retrying…' : 'retry'}
        </button>
      )}
    </div>
  );
}
