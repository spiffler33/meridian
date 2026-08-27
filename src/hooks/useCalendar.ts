/**
 * The calendar mirror's data.
 *
 * Cache first, always: the day's shape paints from IndexedDB and never waits
 * on the network, so an airplane-mode open shows the events that were there
 * last time rather than an empty day. The sync then runs behind it and, if the
 * mirror moved, hands back a fresher copy.
 *
 * It syncs when the app opens and when the window is focused again — the same
 * trigger set as the reading pane, but mounted at the app rather than at one
 * view, because the calendar is what the day is planned against and it must
 * already be current when that day is first looked at.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getMeta } from '../lib/db';
import { isMirrorStale, type CalendarMirror } from '../lib/calendar';
import { loadCalendar, calendarParseError, syncCalendar } from '../lib/calendarSync';
import { GitHubError, RATE_LIMITED_REASON } from '../lib/github';

export interface CalendarView {
  mirror: CalendarMirror | null;
  /** False until the first cache read settles, whether or not it found anything. */
  loaded: boolean;
  /** Whether a read-only token is stored on this device. */
  configured: boolean;
  syncing: boolean;
  /** A sync failure, or a cached file that cannot be parsed. */
  error: string | null;
  /** When this device last completed a calendar sync, epoch ms. */
  lastSyncedAt: number | null;
  /** The mirror has gone quiet during the hours it should be running. */
  stale: boolean;
  refresh: () => void;
}

/**
 * Never the raw error. A GitHubError's message is safe — it carries a status
 * and an action, never the token — but "HTTP 403" is not an answer, and a rate
 * limit must never read as a bad token.
 */
function describe(error: unknown): string {
  if (error instanceof GitHubError) {
    switch (error.kind) {
      case 'auth':
        return 'the read token was refused — check it in settings';
      case 'ratelimit':
        return RATE_LIMITED_REASON;
      case 'network':
        return 'offline — showing the last mirror that synced';
      default:
        return error.message;
    }
  }
  return 'the calendar mirror could not be refreshed';
}

export function useCalendar(): CalendarView {
  const [mirror, setMirror] = useState<CalendarMirror | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Nothing may be set after the app unmounts: the sync outlives it by however
  // long GitHub takes to answer.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const sync = useCallback(async () => {
    const token = await getMeta<string>('newslettersToken');
    if (!live.current) return;
    if (token === undefined || token.length === 0) {
      setConfigured(false);
      return;
    }
    setConfigured(true);
    setSyncing(true);
    try {
      const result = await syncCalendar(token);
      if (!live.current) return;
      if (result.changed) setMirror(await loadCalendar());
      if (!live.current) return;
      setLastSyncedAt((await getMeta<number>('gitread:calendar-data:fetchedAt')) ?? null);
      // A file that arrived but cannot be read is a failure the owner has to
      // see; it is not a sync error, and it does not clear on a retry.
      setError(await calendarParseError());
    } catch (failure) {
      if (live.current) setError(describe(failure));
    } finally {
      if (live.current) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const paint = async () => {
      try {
        const [cached, at] = await Promise.all([
          loadCalendar(),
          getMeta<number>('gitread:calendar-data:fetchedAt'),
        ]);
        if (!live.current) return;
        setMirror(cached);
        setLastSyncedAt(at ?? null);
      } catch {
        // A cache that cannot be read is a day with no events on it, not a
        // dead app. The sync behind this will say what is actually wrong.
      } finally {
        if (live.current) setLoaded(true);
      }
    };

    void paint().then(sync);

    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [sync]);

  const refresh = useCallback(() => {
    void sync();
  }, [sync]);

  return {
    mirror,
    loaded,
    configured,
    syncing,
    error,
    lastSyncedAt,
    // Read at render rather than held in state: staleness is a fact about the
    // clock, and a boolean frozen at sync time would say "fresh" for an hour
    // after it stopped being true.
    stale: isMirrorStale(mirror?.generatedAt ?? null, Date.now()),
    refresh,
  };
}
