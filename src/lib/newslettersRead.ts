/**
 * Reading what the sync brought down.
 *
 * Everything the pane draws comes from the cache, so every surface renders
 * offline once it has been synced. The one exception is a source entry, which
 * is fetched on first open and then cached like the rest: 322 documents is the
 * bulk of the repo, and pulling all of it to show a list of it would be the
 * corpus for none of the benefit.
 */

import { FIGURES_FILE, RAW_PREFIX } from './citations';
import { getCachedContent, getMeta, putCachedContent } from './db';
import { GitHubError } from './github';
import { NEWSLETTERS, getBlob, type TreeEntry } from './gitread';
import { compareCodeUnits } from './order';

/** A file that is missing, unreadable, or not what it claimed to be — named. */
export class ContentError extends Error {
  path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = 'ContentError';
    this.path = path;
  }
}

const BRIEFS_PREFIX = 'state/briefs/';
const CHARTS_PREFIX = 'state/charts/';
const CHART_FILE = 'chart.json';
const CANON_PREFIX = 'state/canon/lessons/';
const SYLLABUS_FILE = 'syllabus.json';
const DAY_PREFIX = 'day-';
const DAY_EXTENSION = '.json';
const ESSAYS_PREFIX = 'wiki/essays/';
const MARKDOWN_EXTENSION = '.md';

export const TAPE_PATH = 'state/tape.json';

export async function cachedTree(): Promise<TreeEntry[]> {
  const tree = await getMeta<unknown>('gitread:newsletters:tree');
  return Array.isArray(tree) ? (tree as TreeEntry[]) : [];
}

export async function cachedText(path: string): Promise<string | null> {
  const record = await getCachedContent('newsletters', path);
  return record?.text ?? null;
}

/**
 * A cached JSON file, or null where it has not been synced. A file that is
 * present but unparseable throws rather than reads as absent: the surface has
 * to be able to say which path is broken.
 */
export async function cachedJson<T>(path: string): Promise<T | null> {
  const text = await cachedText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ContentError('this file is not readable json', path);
  }
}

/**
 * `state/briefs/<date>.md` → the dates, newest first.
 *
 * One brief a morning, named for the day it covers, so the filename is the
 * whole identity of the thing — no slug, no directory. A name that is not
 * that shape is not a brief and is skipped rather than guessed at.
 */
export function briefDates(paths: readonly string[]): string[] {
  const dates: string[] = [];
  for (const path of paths) {
    if (!path.startsWith(BRIEFS_PREFIX)) continue;
    const name = path.slice(BRIEFS_PREFIX.length);
    if (name.includes('/') || !name.endsWith(MARKDOWN_EXTENSION)) continue;
    dates.push(name.slice(0, -MARKDOWN_EXTENSION.length));
  }
  return dates.sort(descending);
}

export function briefPath(date: string): string {
  return `${BRIEFS_PREFIX}${date}${MARKDOWN_EXTENSION}`;
}

/** `state/charts/<date>--<slug>/chart.json` → the directory names, newest first. */
export function chartIds(paths: readonly string[]): string[] {
  const ids: string[] = [];
  for (const path of paths) {
    if (!path.startsWith(CHARTS_PREFIX)) continue;
    const rest = path.slice(CHARTS_PREFIX.length).split('/');
    if (rest.length === 2 && rest[1] === CHART_FILE) ids.push(rest[0]);
  }
  return ids.sort(descending);
}

export function chartPath(id: string): string {
  return `${CHARTS_PREFIX}${id}/${CHART_FILE}`;
}

/** `state/canon/lessons/<doc>/syllabus.json` → the documents that have one. */
export function canonDocIds(paths: readonly string[]): string[] {
  const ids: string[] = [];
  for (const path of paths) {
    if (!path.startsWith(CANON_PREFIX)) continue;
    const rest = path.slice(CANON_PREFIX.length).split('/');
    if (rest.length === 2 && rest[1] === SYLLABUS_FILE) ids.push(rest[0]);
  }
  return ids.sort();
}

export function syllabusPath(doc: string): string {
  return `${CANON_PREFIX}${doc}/${SYLLABUS_FILE}`;
}

/** Days are `day-04.json`; the number is zero-padded to two on disk. */
export function dayPath(doc: string, day: number): string {
  return `${CANON_PREFIX}${doc}/${DAY_PREFIX}${String(day).padStart(2, '0')}${DAY_EXTENSION}`;
}

/**
 * The days of one course that have actually been written, ascending.
 *
 * A syllabus declares the whole course on day one; the days themselves arrive
 * one a morning, which is the point of the thing. So the syllabus says how
 * long the course is and this says how much of it exists — and the difference
 * between the two is a course still being delivered.
 *
 * Reading the number back out of the filename is the inverse of `dayPath`, on
 * a name this repo's own pipeline writes. Anything that is not that shape is
 * not a day and is skipped rather than guessed at.
 */
export function canonDayNumbers(paths: readonly string[], doc: string): number[] {
  const prefix = `${CANON_PREFIX}${doc}/${DAY_PREFIX}`;
  const days: number[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix) || !path.endsWith(DAY_EXTENSION)) continue;
    const middle = path.slice(prefix.length, path.length - DAY_EXTENSION.length);
    if (middle.length === 0 || middle.includes('/')) continue;
    const day = Number(middle);
    if (!Number.isInteger(day) || day <= 0) continue;
    days.push(day);
  }
  return days.sort((a, b) => a - b);
}

export function essaySlugs(paths: readonly string[]): string[] {
  const slugs: string[] = [];
  for (const path of paths) {
    if (!path.startsWith(ESSAYS_PREFIX)) continue;
    const name = path.slice(ESSAYS_PREFIX.length);
    if (name.includes('/') || !name.endsWith(MARKDOWN_EXTENSION)) continue;
    slugs.push(name.slice(0, -MARKDOWN_EXTENSION.length));
  }
  return slugs.sort(descending);
}

export function essayPath(slug: string): string {
  return `${ESSAYS_PREFIX}${slug}${MARKDOWN_EXTENSION}`;
}

function entryPath(slug: string): string {
  return `${RAW_PREFIX}${slug}/${slug}${MARKDOWN_EXTENSION}`;
}

function figuresPath(slug: string): string {
  return `${RAW_PREFIX}${slug}/${FIGURES_FILE}`;
}

/** Plain code-unit order, reversed. Slugs lead with their date. */
function descending(a: string, b: string): number {
  return compareCodeUnits(b, a);
}

export interface SourceEntry {
  slug: string;
  prose: string;
  /** The figure reads, where the entry has any. There are no image files. */
  figures: string | null;
}

async function readOrFetch(entry: TreeEntry): Promise<string> {
  const cached = await getCachedContent('newsletters', entry.path);
  if (cached && cached.sha === entry.sha) return cached.text;

  const token = await getMeta<string>('newslettersToken');
  if (token === undefined || token.length === 0) {
    throw new ContentError('this file has not been downloaded to this device', entry.path);
  }

  const text = await getBlob(token, NEWSLETTERS, entry.sha);
  // Cached on the way past: the second open of an entry is offline-capable,
  // and that is the whole reason a reader is worth having on a phone.
  await putCachedContent('newsletters', {
    path: entry.path,
    text,
    sha: entry.sha,
    fetchedAt: Date.now(),
  });
  return text;
}

/**
 * A source entry, fetched on open.
 *
 * Being offline with nothing cached is a `GitHubError` from the transport,
 * which the surface reports as such. Not existing at all is a ContentError
 * naming the path, because that is a different problem with a different fix.
 */
export async function fetchEntry(slug: string): Promise<SourceEntry> {
  const tree = await cachedTree();
  const prosePath = entryPath(slug);
  const prose = tree.find(file => file.path === prosePath);
  if (!prose) throw new ContentError('the corpus has no entry by that name', prosePath);

  const figures = tree.find(file => file.path === figuresPath(slug));
  return {
    slug,
    prose: await readOrFetch(prose),
    figures: figures ? await readOrFetch(figures) : null,
  };
}

/** Whatever went wrong, in a line the owner can act on. Never a raw error. */
export function describeReadFailure(error: unknown): { what: string; detail: string | null } {
  if (error instanceof ContentError) {
    return { what: error.message, detail: error.path };
  }
  if (error instanceof GitHubError) {
    switch (error.kind) {
      case 'auth':
        return { what: 'the newsletters token was refused — check it in settings', detail: null };
      case 'ratelimit':
        return { what: "github's rate limit — the token is fine, try again shortly", detail: null };
      case 'network':
        return { what: 'offline — this one has not been downloaded yet', detail: null };
      default:
        return { what: error.message, detail: null };
    }
  }
  return { what: 'this could not be read', detail: null };
}
