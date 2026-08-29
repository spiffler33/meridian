/**
 * What the calendar mirror did, and whether it can be trusted right now.
 *
 * There is no token field here. One read-only PAT selects both mirror repos
 * (it is entered in the newsletters block above), so this asks only the
 * questions that are about *this* repo: does the grant reach it, when was the
 * file last written, and does what arrived still parse.
 *
 * Freshness is the point of the block. A mirror that stopped updating looks
 * exactly like a quiet week until something says otherwise, so the amber line
 * is not decoration — a silent stale mirror is the failure this exists to
 * make impossible.
 */

import { useState } from 'react';

import { getMeta } from '../lib/db';
import { CALENDAR_DATA, verifyReadAccess } from '../lib/gitread';
import { useCalendar } from '../hooks/useCalendar';

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
 * clock is not trustworthy, and "written in 3 hours" is worse than no answer.
 */
function relative(at: number): string {
  const [value, unit] = relativeParts(Math.min(0, at - Date.now()));
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);
}

export function CalendarSettings() {
  const calendar = useCalendar();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleVerify = async () => {
    if (checking) return;
    setChecking(true);
    setMessage('');
    setFailed(false);
    try {
      const token = await getMeta<string>('newslettersToken');
      if (token === undefined || token.length === 0) {
        setMessage('no read-only token is stored on this device yet');
        setFailed(true);
        return;
      }
      const result = await verifyReadAccess(token, CALENDAR_DATA);
      setMessage(
        result.ok ? 'read access confirmed' : result.reason ?? 'access could not be confirmed'
      );
      setFailed(!result.ok);
    } catch {
      setMessage('access could not be checked');
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  const mirror = calendar.mirror;

  return (
    <div className="space-y-2">
      <div className="text-xs text-text-secondary">calendar mirror</div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button
            onClick={handleVerify}
            disabled={checking}
            className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors disabled:opacity-50"
          >
            {checking ? 'checking...' : 'verify access'}
          </button>
          <button
            onClick={calendar.refresh}
            disabled={calendar.syncing}
            className="px-3 py-1.5 text-sm rounded border border-border text-text-muted hover:text-accent transition-colors disabled:opacity-50"
          >
            {calendar.syncing ? 'syncing...' : 'sync now'}
          </button>
        </div>

        {message && (
          <div className={failed ? 'text-xs text-error' : 'text-xs text-text-muted'}>{message}</div>
        )}

        {!calendar.configured && (
          <div className="text-xs text-error">
            no read-only token on this device — add it in newsletters above; the same token serves
            both mirrors.
          </div>
        )}

        {calendar.error && <div className="text-xs text-error">{calendar.error}</div>}

        {calendar.stale && mirror && (
          <div className=" text-xs text-accent">
            mirror stale — last written {relative(mirror.generatedAt)}, and the action should have
            run since.
          </div>
        )}

        <div className=" text-xs text-text-muted">
          {mirror
            ? `${mirror.events.length} events · ${mirror.calendars.join(' · ')} · ${mirror.window.start} → ${mirror.window.end}`
            : calendar.loaded
              ? 'no mirror on this device yet.'
              : 'reading the cached mirror...'}
        </div>

        <div className="text-xs text-text-muted">
          {mirror ? `written ${relative(mirror.generatedAt)}. ` : ''}
          {calendar.lastSyncedAt === null
            ? 'never synced to this device.'
            : `synced ${relative(calendar.lastSyncedAt)}.`}
        </div>

        <div className="text-xs text-text-muted">
          {CALENDAR_DATA.owner}/{CALENDAR_DATA.repo}, contents read only. a scheduled action there
          is the only writer — meridian never writes to it, and google calendar stays the place
          events are created.
        </div>
      </div>
    </div>
  );
}
