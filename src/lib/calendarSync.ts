/**
 * Calendar mirror sync.
 *
 * The same shape as the newsletters sync and for the same reasons: the head
 * commit is one request, an unmoved head ends the sync before a tree is read,
 * and it runs outside the meridian-data queue so a calendar read can never
 * block a backup of the journal.
 *
 * It is smaller in one way. The newsletters repo has a state tier of tens of
 * files; this one has a single file the app cares about, so the tree read
 * exists only to learn that file's blob sha.
 */

import { singleFlight } from './async';
import { getCachedContent, getMeta, putCachedContent, cachedContentShas, setMeta } from './db';
import { EVENTS_PATH, parseCalendar, type CalendarMirror } from './calendar';
import { CALENDAR_DATA, getBlob, getHeadSha, getTree, selectStale } from './gitread';

export interface CalendarSyncResult {
  /** False when the head had not moved and nothing was read beyond it. */
  changed: boolean;
  fetched: number;
  head: string;
}

/**
 * The mirror as the cache can tell it, with no network at all. This is what
 * the day paints from, every time, including on an airplane-mode cold open.
 */
export async function loadCalendar(): Promise<CalendarMirror | null> {
  const record = await getCachedContent('calendar-data', EVENTS_PATH);
  if (!record) return null;
  return parseCalendar(record.text).mirror;
}

/** Why the cached mirror could not be read, when it could not. */
export async function calendarParseError(): Promise<string | null> {
  const record = await getCachedContent('calendar-data', EVENTS_PATH);
  if (!record) return null;
  return parseCalendar(record.text).error;
}

/** One sync at a time per tab. Open and focus can land in the same moment. */
export const syncCalendar = singleFlight(runSync);

async function runSync(token: string): Promise<CalendarSyncResult> {
  const head = await getHeadSha(token, CALENDAR_DATA);
  const knownHead = await getMeta<unknown>('gitread:calendar-data:headSha');
  const cached = await cachedContentShas('calendar-data');

  // The cheapest possible answer: the repo has not moved, and the file it
  // describes is already here. The Action commits only when events change, so
  // most opens of a quiet day stop on this line.
  if (head === knownHead && cached.has(EVENTS_PATH)) {
    return { changed: false, fetched: 0, head };
  }

  const tree = await getTree(token, CALENDAR_DATA, head);
  const wanted = tree.filter(entry => entry.path === EVENTS_PATH);
  const stale = selectStale(wanted, cached);
  for (const entry of stale) {
    const text = await getBlob(token, CALENDAR_DATA, entry.sha);
    await putCachedContent('calendar-data', {
      path: entry.path,
      text,
      sha: entry.sha,
      fetchedAt: Date.now(),
    });
  }

  // Recorded last, and only together. A head stored before the file had landed
  // would tell the next open that everything was already here.
  await setMeta('gitread:calendar-data:fetchedAt', Date.now());
  await setMeta('gitread:calendar-data:headSha', head);

  return { changed: stale.length > 0, fetched: stale.length, head };
}
