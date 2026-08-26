/**
 * Newsletters sync and the selectors it runs on.
 *
 * The transport in newsletters.ts knows GitHub; this knows what to ask it for
 * and where the answers go. It is deliberately outside the meridian-data
 * queue: a different repo, a different token, no shared lock. A read of the
 * library can never block or be blocked by a backup of the journal.
 *
 * The freshness check is one request. The head commit either moved or it did
 * not, and if it did not there is nothing in the repo that could have changed,
 * so the sync is over before it has read a tree or a single file.
 *
 * The selectors below are pure and separately testable, which is the point:
 * they decide what gets fetched, and a mistake there is either a library with
 * holes in it or a phone re-downloading the corpus on every open.
 */

import { getCachedContent, getMeta, putCachedContent, cachedContentShas, setMeta } from './db';
import { getBlob, getHeadSha, getTree, type TreeEntry } from './newsletters';

/**
 * Fetched on every sync: everything the pane renders from. Tens of files, and
 * only the ones whose sha actually moved.
 *
 * `raw/` is not here on purpose. It is the bulk of the repo and it is only
 * ever read one entry at a time, on open — pulling 300 source documents to
 * show a list of them would be the whole corpus for none of the benefit.
 */
const STATE_TIER = [
  'state/gists.md',
  'state/tape.json',
  'state/briefs/',
  'state/charts/',
  'state/canon/',
  'wiki/essays/',
];

/** Git's empty-directory marker. It carries nothing and is never worth a request. */
const PLACEHOLDER_NAME = '.gitkeep';

const RAW_PREFIX = 'raw/';
const ENTRY_EXTENSION = '.md';
const SLUG_DATE_SEPARATOR = '--';
const GISTS_PATH = 'state/gists.md';

/**
 * gists.md declares its own line format: `<slug> | <what the piece says>`.
 * Machine-maintained, machine-appended, one line per entry.
 */
const GIST_SEPARATOR = ' | ';

export interface LibraryEntry {
  slug: string;
  /** The date the slug carries, e.g. `2026-08-21`. Empty if the slug has none. */
  date: string;
  /** The rest of the slug — the entry's name as the corpus knows it. */
  name: string;
  /** The one-line gist, where gists.md has one for this entry. */
  gist: string | null;
}

function basename(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/** Everything the pane renders from, and nothing else. */
export function selectStateTier(tree: readonly TreeEntry[]): TreeEntry[] {
  return tree.filter(entry => {
    if (typeof entry?.path !== 'string') return false;
    if (basename(entry.path) === PLACEHOLDER_NAME) return false;
    return STATE_TIER.some(prefix => entry.path === prefix || entry.path.startsWith(prefix));
  });
}

/**
 * What is wanted and is not already held at that exact sha.
 *
 * The comparison is against what the cache actually holds rather than against
 * the last tree we saw: a sync that dies half way through leaves the files it
 * managed to fetch cached, and the next one picks up only what is missing.
 */
export function selectStale(
  wanted: readonly TreeEntry[],
  cached: ReadonlyMap<string, string>
): TreeEntry[] {
  return wanted.filter(entry => cached.get(entry.path) !== entry.sha);
}

/**
 * The entries the corpus holds, from the tree.
 *
 * An entry is a directory under `raw/` holding a markdown file named after it
 * — the pipeline's own convention, and the only thing that separates a real
 * entry from the empty `raw/chats`, `raw/newsletters` and `raw/notes`
 * placeholders that also live there.
 */
export function selectEntrySlugs(tree: readonly TreeEntry[]): string[] {
  const slugs: string[] = [];
  for (const entry of tree) {
    if (typeof entry?.path !== 'string' || !entry.path.startsWith(RAW_PREFIX)) continue;
    const parts = entry.path.slice(RAW_PREFIX.length).split('/');
    if (parts.length !== 2) continue;
    const [slug, file] = parts;
    if (slug.length > 0 && file === `${slug}${ENTRY_EXTENSION}`) slugs.push(slug);
  }
  return slugs;
}

/**
 * The gist for each entry that has one.
 *
 * The file's prose header describes its own format, so a line of that header
 * contains the separator too. Nothing here guesses at which lines are prose:
 * a line counts only if what stands before the separator is a slug the tree
 * says exists. The tree is the authority on what an entry is; this file only
 * says what each one is about.
 */
export function parseGists(text: string, known: ReadonlySet<string>): Map<string, string> {
  const gists = new Map<string, string>();
  for (const line of text.split('\n')) {
    const cut = line.indexOf(GIST_SEPARATOR);
    if (cut === -1) continue;
    const slug = line.slice(0, cut).trim();
    if (!known.has(slug)) continue;
    gists.set(slug, line.slice(cut + GIST_SEPARATOR.length).trim());
  }
  return gists;
}

function splitSlug(slug: string): { date: string; name: string } {
  const cut = slug.indexOf(SLUG_DATE_SEPARATOR);
  if (cut === -1) return { date: '', name: slug };
  return { date: slug.slice(0, cut), name: slug.slice(cut + SLUG_DATE_SEPARATOR.length) };
}

/**
 * The library, newest first.
 *
 * Slugs lead with their date, so ordering by slug orders by date — and the
 * comparison is plain code-unit, never locale-aware, for the same reason the
 * journal's fold order is: two devices must agree on the answer.
 */
export function buildLibrary(tree: readonly TreeEntry[], gistsText: string): LibraryEntry[] {
  const slugs = selectEntrySlugs(tree);
  const gists = parseGists(gistsText, new Set(slugs));
  return slugs
    .map(slug => ({ slug, ...splitSlug(slug), gist: gists.get(slug) ?? null }))
    .sort((a, b) => (a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0));
}

function cachedTree(value: unknown): TreeEntry[] {
  return Array.isArray(value) ? (value as TreeEntry[]) : [];
}

/**
 * The library as the cache can tell it, with no network at all. This is what
 * the pane paints first, every time, including on an airplane-mode cold open.
 */
export async function loadLibrary(): Promise<LibraryEntry[]> {
  const tree = cachedTree(await getMeta<unknown>('nlTree'));
  if (tree.length === 0) return [];
  const gists = await getCachedContent(GISTS_PATH);
  return buildLibrary(tree, gists?.text ?? '');
}

export interface SyncResult {
  /** False when the head had not moved and nothing was read beyond it. */
  changed: boolean;
  fetched: number;
  head: string;
}

let running: Promise<SyncResult> | null = null;

/**
 * One sync at a time per tab. Opening the pane and focusing the window in the
 * same moment would otherwise run two of these over the same files.
 */
export function syncNewsletters(token: string): Promise<SyncResult> {
  if (!running) {
    running = runSync(token).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runSync(token: string): Promise<SyncResult> {
  const head = await getHeadSha(token);
  const knownHead = await getMeta<unknown>('nlHeadSha');
  const tree = cachedTree(await getMeta<unknown>('nlTree'));

  // The cheapest possible answer: the repo has not moved, and the tree we have
  // still describes it. Nothing further is read.
  if (head === knownHead && tree.length > 0) {
    return { changed: false, fetched: 0, head };
  }

  const fresh = await getTree(token, head);
  await setMeta('nlTree', fresh);

  const stale = selectStale(selectStateTier(fresh), await cachedContentShas());
  for (const entry of stale) {
    const text = await getBlob(token, entry.sha);
    await putCachedContent({ path: entry.path, text, sha: entry.sha, fetchedAt: Date.now() });
  }

  // Recorded last, and only together. A head stored before its files had
  // landed would tell the next open that everything was already here, and the
  // missing files would never be fetched again.
  await setMeta('nlTreeFetchedAt', Date.now());
  await setMeta('nlHeadSha', head);

  return { changed: true, fetched: stale.length, head };
}
