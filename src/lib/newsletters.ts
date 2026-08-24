/**
 * Read-only transport for the newsletters repo.
 *
 * Pure transport, on github.ts's terms: no IndexedDB, no React, no app state,
 * and the token is always a parameter. It shares that file's request plumbing
 * and its error taxonomy — callers branch on `GitHubError.kind`, never on a
 * status, because several of those statuses are ours rather than GitHub's.
 *
 * Two things make this different from the journal transport.
 *
 * It never writes. Not a branch, not a commit, not a PUT — the read-only PAT
 * is the enforcement, and the absence of any write path here is the guard that
 * does not depend on the owner having scoped the token correctly.
 *
 * And it moves over trees and blobs rather than the contents API. The contents
 * API stops returning content at 1 MB (`encoding: "none"`, see CLAUDE.md
 * limitation 2); `git/blobs` carries to 100 MB. One transport for every file
 * in the repo, with no size-dependent special case to forget about.
 */

import {
  GitHubError,
  RATE_LIMITED_REASON,
  UNREACHABLE_REASON,
  call,
  failure,
  fromBase64,
  readJson,
  type AccessResult,
} from './github';

export const NEWSLETTERS_OWNER = 'spiffler33';
export const NEWSLETTERS_REPO = 'newsletters';
export const NEWSLETTERS_BRANCH = 'main';

/** Total attempts for a read that keeps hitting a 5xx. */
const MAX_ATTEMPTS = 3;
/** Delay before attempts 2 and 3. */
const RETRY_BACKOFF_MS = [250, 750];
/** Random share added on top, so two devices do not retry in lockstep. */
const RETRY_JITTER = 0.25;

/** GitHub answered, but the body it sent cannot be used. Not a status GitHub reported. */
const UNUSABLE_RESPONSE_STATUS = 502;

const NO_ACCESS_REASON = 'this token cannot read that repo — check the grant';
const UNCONFIRMED_REASON = 'access could not be confirmed';

/** A file in the repo, as the tree lists it. `sha` is a blob sha, not a commit. */
export interface TreeEntry {
  path: string;
  sha: string;
  size: number;
}

const repoBase = `/repos/${NEWSLETTERS_OWNER}/${NEWSLETTERS_REPO}`;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelay(attempt: number): number {
  const base = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
  return Math.round(base * (1 + Math.random() * RETRY_JITTER));
}

/**
 * One GET, retried only where retrying can help.
 *
 * A 5xx is GitHub having a bad minute and is worth three attempts. A 4xx is an
 * answer — retrying it just spends the rate limit to be told the same thing.
 * A network failure is not retried either: each attempt can sit for the full
 * 30 s abort, and three of those is a minute and a half of a pane that looks
 * hung when the honest answer, offline, is already on screen from cache.
 */
async function get(token: string, path: string, action: string): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await call(token, path);
    if (response.ok) return response;
    if (attempt >= MAX_ATTEMPTS - 1 || response.status < 500) {
      throw failure(response, 'GET', action);
    }
    await sleep(retryDelay(attempt));
  }
}

function unusable(action: string): GitHubError {
  return new GitHubError(
    `GitHub sent an unexpected body while ${action}`,
    UNUSABLE_RESPONSE_STATUS,
    'http'
  );
}

/**
 * Proves the token can read the repo by reading it.
 *
 * The journal transport proves *write* access with a PUT that cannot land,
 * because GitHub reports the owner's role rather than the token's grant. A
 * read grant needs no such trick: a read that returns the repo is the proof,
 * and a read that is refused is the disproof.
 *
 * A rate limit is neither. It never reports as a bad token — the owner must
 * not be sent off to reissue a PAT that was fine all along.
 */
export async function verifyReadAccess(token: string): Promise<AccessResult> {
  try {
    const response = await call(token, repoBase);
    if (response.ok) return { ok: true };

    const error = failure(response, 'GET', 'checking newsletters access');
    if (error.kind === 'ratelimit') return { ok: false, reason: RATE_LIMITED_REASON };
    // 404 is what a private repo says to a token that cannot see it, and it is
    // the same answer as a repo that does not exist. Either way: no access.
    if (error.kind === 'auth' || response.status === 404) {
      return { ok: false, reason: NO_ACCESS_REASON };
    }
    return { ok: false, reason: UNCONFIRMED_REASON };
  } catch (error) {
    if (error instanceof GitHubError && error.kind === 'network') {
      return { ok: false, reason: UNREACHABLE_REASON };
    }
    return { ok: false, reason: UNCONFIRMED_REASON };
  }
}

/**
 * The head commit of the default branch — the whole freshness check.
 *
 * One request per open. Unchanged head means nothing in the repo has moved,
 * and the sync is over without a tree read or a single blob.
 */
export async function getHeadSha(token: string): Promise<string> {
  const action = 'reading the newsletters head';
  const response = await get(token, `${repoBase}/branches/${NEWSLETTERS_BRANCH}`, action);
  const body = (await readJson(response, action)) as { commit?: { sha?: unknown } };
  const sha = body.commit?.sha;
  if (typeof sha !== 'string' || sha.length === 0) throw unusable(action);
  return sha;
}

/**
 * Every file in the repo at that commit.
 *
 * A truncated tree is a visible error rather than a shorter list: silently
 * syncing part of the repo would show a library with holes in it and no
 * indication that anything was missing.
 */
export async function getTree(token: string, sha: string): Promise<TreeEntry[]> {
  const action = 'reading the newsletters tree';
  const response = await get(
    token,
    `${repoBase}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
    action
  );
  const body = (await readJson(response, action)) as { tree?: unknown; truncated?: unknown };

  if (body.truncated === true) {
    throw new GitHubError(
      'the newsletters tree came back truncated — the library would be missing entries',
      UNUSABLE_RESPONSE_STATUS,
      'http'
    );
  }
  if (!Array.isArray(body.tree)) throw unusable(action);

  const files: TreeEntry[] = [];
  for (const raw of body.tree) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as { path?: unknown; sha?: unknown; size?: unknown; type?: unknown };
    // Directories carry no content, and an entry with no sha cannot be
    // fetched even if it does.
    if (entry.type !== 'blob') continue;
    if (typeof entry.path !== 'string' || typeof entry.sha !== 'string') continue;
    files.push({
      path: entry.path,
      sha: entry.sha,
      size: typeof entry.size === 'number' ? entry.size : 0,
    });
  }
  return files;
}

/**
 * One file's text, by blob sha.
 *
 * base64 → bytes → UTF-8. Never `atob` straight to a string: that reads each
 * byte as a code point, so every accented name and every em dash in the corpus
 * would arrive as mojibake, quietly, with nothing to indicate a decode ever
 * went wrong.
 */
export async function getBlob(token: string, sha: string): Promise<string> {
  const action = 'reading a newsletters file';
  const response = await get(token, `${repoBase}/git/blobs/${encodeURIComponent(sha)}`, action);
  const body = (await readJson(response, action)) as { content?: unknown; encoding?: unknown };

  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new GitHubError(
      'GitHub returned a file in a form this cannot decode',
      UNUSABLE_RESPONSE_STATUS,
      'http'
    );
  }
  return fromBase64(body.content);
}
