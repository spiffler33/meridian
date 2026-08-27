/**
 * The Read pane's data.
 *
 * Cache first, always: the library paints from IndexedDB and never waits on
 * the network, so an airplane-mode open shows the corpus rather than a spinner
 * or an empty state. The sync then runs behind it and, if anything moved,
 * hands back a fresher list.
 *
 * It syncs when the pane opens and when the window is focused again. That is
 * the whole trigger set — the pane is the only thing that reads this repo, so
 * nothing is fetched for an owner who never opens it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getMeta } from '../lib/db';
import { GitHubError, RATE_LIMITED_REASON } from '../lib/github';
import { loadLibrary, syncNewsletters, type LibraryEntry } from '../lib/newslettersSync';

export interface NewslettersView {
  rows: LibraryEntry[];
  /** False until the first cache read settles, whether or not it found anything. */
  loaded: boolean;
  /** Whether a read-only token is stored on this device. */
  configured: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncedAt: number | null;
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
        return 'the newsletters token was refused — check it in settings';
      case 'ratelimit':
        return RATE_LIMITED_REASON;
      case 'network':
        return 'offline — showing the last copy that synced';
      default:
        return error.message;
    }
  }
  return 'the library could not be refreshed';
}

export function useNewsletters(): NewslettersView {
  const [rows, setRows] = useState<LibraryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Nothing may be set after the pane closes: the sync outlives it by however
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
      const result = await syncNewsletters(token);
      if (!live.current) return;
      if (result.changed) setRows(await loadLibrary());
      if (!live.current) return;
      setLastSyncedAt((await getMeta<number>('gitread:newsletters:fetchedAt')) ?? null);
      setError(null);
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
          loadLibrary(),
          getMeta<number>('gitread:newsletters:fetchedAt'),
        ]);
        if (!live.current) return;
        setRows(cached);
        setLastSyncedAt(at ?? null);
      } catch {
        // A cache that cannot be read is an empty library, not a dead pane.
        // The sync behind this will say what is actually wrong.
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

  return { rows, loaded, configured, syncing, error, lastSyncedAt, refresh };
}
