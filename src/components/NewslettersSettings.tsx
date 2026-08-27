/**
 * The newsletters token, and what the library did with it.
 *
 * A second PAT, kept apart from the backup one on purpose: different repo,
 * different grant, and read-only. Clearing one must never disarm the other,
 * which is why it has its own field rather than a shared one with a switch.
 *
 * Same rules as every other secret here — it lives only in the IndexedDB
 * `meta` store, it is never shown again once saved, and nothing derived from
 * a failure while handling it is rendered.
 */

import { useEffect, useState } from 'react';

import { deleteMeta, getMeta, setMeta } from '../lib/db';
import { CALENDAR_DATA, NEWSLETTERS, verifyReadAccess } from '../lib/gitread';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function relativeParts(deltaMs: number): [number, Intl.RelativeTimeFormatUnit] {
  const size = Math.abs(deltaMs);
  if (size < MINUTE_MS) return [Math.round(deltaMs / 1000), 'second'];
  if (size < HOUR_MS) return [Math.round(deltaMs / MINUTE_MS), 'minute'];
  if (size < DAY_MS) return [Math.round(deltaMs / HOUR_MS), 'hour'];
  return [Math.round(deltaMs / DAY_MS), 'day'];
}

/**
 * Clamped to the present for the same reason the backup line is: this device's
 * clock is not trustworthy, and "synced in 3 hours" is worse than no answer.
 */
function syncedLine(at: number | null): string {
  if (at === null) return 'nothing synced to this device yet.';
  const [value, unit] = relativeParts(Math.min(0, at - Date.now()));
  return `library synced ${new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit)}.`;
}

export function NewslettersSettings() {
  const [draft, setDraft] = useState('');
  const [stored, setStored] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    // Only ever whether one is stored. The token itself never reaches state.
    void Promise.all([
      getMeta<string>('newslettersToken').then(Boolean),
      getMeta<number>('gitread:newsletters:fetchedAt'),
    ]).then(
      ([hasToken, at]) => {
        if (!live) return;
        setStored(hasToken);
        setSyncedAt(at ?? null);
      },
      () => undefined
    );
    return () => {
      live = false;
    };
  }, []);

  const handleSave = async () => {
    const next = draft.trim();
    if (next.length === 0) return;
    try {
      await setMeta('newslettersToken', next);
      setDraft('');
      setStored(true);
      setMessage('');
      setFailed(false);
    } catch {
      // The reason is dropped rather than reported: it was raised while
      // handling the token, and nothing derived from it may be rendered.
      setMessage('the token could not be saved on this device');
      setFailed(true);
    }
  };

  const handleClear = async () => {
    try {
      await deleteMeta('newslettersToken');
      setDraft('');
      setStored(false);
      setMessage('the token is no longer stored on this device');
      setFailed(false);
    } catch {
      setMessage('the token could not be removed from this device');
      setFailed(true);
    }
  };

  const handleVerify = async () => {
    if (checking) return;
    setChecking(true);
    setMessage('');
    setFailed(false);
    try {
      const token = await getMeta<string>('newslettersToken');
      if (token === undefined || token.length === 0) {
        setMessage('no token is stored on this device yet');
        setFailed(true);
        return;
      }
      const result = await verifyReadAccess(token, NEWSLETTERS);
      setMessage(result.ok ? 'read access confirmed' : result.reason ?? 'access could not be confirmed');
      setFailed(!result.ok);
    } catch {
      setMessage('access could not be checked');
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="bg-bg-card rounded border border-border p-4">
      <div className="text-xs text-text-muted uppercase tracking-wide mb-3">
        newsletters (read-only)
      </div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            type="password"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={stored ? '•••••••• stored on this device' : 'github_pat_...'}
            autoComplete="new-password"
            spellCheck={false}
            className="flex-1 px-2 py-1.5 text-sm rounded border border-border bg-transparent text-text focus:border-accent outline-none font-mono"
          />
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors"
          >
            save
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleVerify}
            disabled={checking}
            className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors disabled:opacity-50"
          >
            {checking ? 'checking...' : 'verify access'}
          </button>
          {stored && (
            <button
              onClick={handleClear}
              className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-error transition-colors"
            >
              clear
            </button>
          )}
        </div>
        {message && (
          <div className={failed ? 'text-xs text-error' : 'text-xs text-text-muted'}>{message}</div>
        )}
        <div className="text-xs text-text-muted">{syncedLine(syncedAt)}</div>
        <div className="text-xs text-text-muted">
          a second fine-grained token, with contents read only, selecting both mirror repos:
          {' '}{NEWSLETTERS.owner}/{NEWSLETTERS.repo} and {CALENDAR_DATA.owner}/
          {CALENDAR_DATA.repo}. meridian never writes to either. it stays on this device and is
          never shown again once saved.
        </div>
      </div>
    </section>
  );
}
