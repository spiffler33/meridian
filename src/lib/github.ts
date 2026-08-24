/**
 * GitHub contents-API transport for the meridian-data journal repo.
 *
 * Pure transport: no IndexedDB, no React, no app state. The token is always a
 * parameter — it lives in IndexedDB and the caller passes it in. It must never
 * appear in a message, a log line, or a thrown object.
 */

export const GITHUB_OWNER = 'spiffler33';
export const GITHUB_REPO = 'meridian-data';
export const GITHUB_API_BASE = 'https://api.github.com';

/** Every mutating call serializes under this one lock name. */
export const PUSH_LOCK_NAME = 'meridian-github-push';

/**
 * Every request is aborted after this long. A captive-portal fetch that never
 * settles would otherwise hold the push lock — origin-wide, across every tab —
 * forever, with no error and no rejection: writes would stop with no symptom.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Total attempts (first try + retries) for an append that keeps conflicting. */
const MAX_APPEND_ATTEMPTS = 3;

/** Delay before retry 2 and retry 3. Back-to-back retries trip GitHub's secondary rate limit. */
const RETRY_BACKOFF_MS = [250, 750];

/** Random share of a backoff added on top, so two devices do not retry in lockstep. */
const RETRY_JITTER = 0.25;

/** A server-supplied retry-after is honoured only up to this; the push lock is held while waiting. */
const MAX_RETRY_DELAY_MS = 5_000;

/** GitHub answered, but the body it sent cannot be used. Not a status GitHub reported. */
const UNUSABLE_RESPONSE_STATUS = 502;

/** Over the contents-API 1 MB read limit. Not a status GitHub reported. */
const TOO_LARGE_STATUS = 413;

/** The caller handed us something unwritable; no request was made. */
const INVALID_LINE_STATUS = 400;

const JOURNAL_DIR = 'journal';
const JOURNAL_EXTENSION = 'jsonl';

// ============================================================================
// Errors
// ============================================================================

/**
 * 'auth'      — 401/403 with credentials actually at fault.
 * 'ratelimit' — 429, or 403 with x-ratelimit-remaining 0. The token is fine; wait.
 * 'conflict'  — 409/422 on a write, a stale sha; the append path retries these.
 * 'network'   — fetch failed or timed out; nothing reached GitHub.
 * 'http'      — any other failure, including a response GitHub sent that we cannot use.
 */
export type GitHubErrorKind = 'auth' | 'ratelimit' | 'conflict' | 'network' | 'http';

export class GitHubError extends Error {
  status: number;
  kind: GitHubErrorKind;
  /** How long GitHub asked us to wait, from retry-after or x-ratelimit-reset, when it said so. */
  retryAfterMs?: number;

  constructor(message: string, status: number, kind: GitHubErrorKind, retryAfterMs?: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

interface HeaderBag {
  get(name: string): string | null;
}

function headerNumber(response: Response, name: string): number | null {
  const headers = response.headers as HeaderBag | undefined;
  if (!headers || typeof headers.get !== 'function') return null;
  const raw = headers.get(name);
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** retry-after is seconds; x-ratelimit-reset is an epoch second. Both become a wait in ms. */
function waitFrom(response: Response): number | undefined {
  const after = headerNumber(response, 'retry-after');
  if (after !== null) return Math.max(0, Math.round(after * 1000));
  const reset = headerNumber(response, 'x-ratelimit-reset');
  if (reset !== null) return Math.max(0, Math.round(reset * 1000 - Date.now()));
  return undefined;
}

/**
 * A rate limit is not a bad token: reporting one as 'auth' would send the owner
 * off to revoke a perfectly good PAT. A 409 only means a stale sha on a write —
 * on a GET it means the repository has no commits yet.
 */
function classify(response: Response, method: string): GitHubErrorKind {
  const status = response.status;
  if (status === 429) return 'ratelimit';
  if (status === 403 && headerNumber(response, 'x-ratelimit-remaining') === 0) return 'ratelimit';
  if (status === 401 || status === 403) return 'auth';
  if ((status === 409 || status === 422) && method !== 'GET') return 'conflict';
  return 'http';
}

function describeFailure(kind: GitHubErrorKind, status: number, action: string): string {
  switch (kind) {
    case 'ratelimit':
      return `GitHub rate limit reached while ${action} (HTTP ${status})`;
    case 'auth':
      return `GitHub rejected the credentials while ${action} (HTTP ${status})`;
    case 'conflict':
      return `GitHub reported a conflicting write while ${action} (HTTP ${status})`;
    default:
      return `GitHub request failed while ${action} (HTTP ${status})`;
  }
}

function failure(response: Response, method: string, action: string): GitHubError {
  const kind = classify(response, method);
  return new GitHubError(describeFailure(kind, response.status, action), response.status, kind, waitFrom(response));
}

// ============================================================================
// Shapes
// ============================================================================

export interface JournalFile {
  path: string;
  name: string;
  sha: string;
  device: string;
  month: string;
}

export interface FileContent {
  text: string;
  sha: string;
}

export interface PutResult {
  sha: string;
}

export interface AccessResult {
  ok: boolean;
  reason?: string;
}

// ============================================================================
// Base64 (UTF-8 safe — btoa over a JS string corrupts non-ASCII)
// ============================================================================

const BINARY_CHUNK = 0x8000;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BINARY_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BINARY_CHUNK));
  }
  return btoa(binary);
}

function fromBase64(data: string): string {
  // The contents API wraps base64 at 60 columns.
  const compact = data.split('\n').join('').split('\r').join('').split(' ').join('');
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// ============================================================================
// Request plumbing
// ============================================================================

interface GitHubRequest {
  method?: string;
  body?: unknown;
}

function contentsPath(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encoded}`;
}

async function call(token: string, path: string, request: GitHubRequest = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${GITHUB_API_BASE}${path}`, {
      method: request.method ?? 'GET',
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
  } catch {
    // Deliberately drops the underlying error: it can carry the request context.
    throw new GitHubError(
      controller.signal.aborted
        ? `GitHub did not respond within ${REQUEST_TIMEOUT_MS}ms`
        : 'Could not reach GitHub',
      0,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Every body read is typed: a truncated or non-JSON body must not escape as a SyntaxError. */
async function readJson(response: Response, action: string): Promise<object> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GitHubError(
      `GitHub sent a body that could not be read while ${action}`,
      UNUSABLE_RESPONSE_STATUS,
      'http',
    );
  }
  if (typeof body !== 'object' || body === null) {
    throw new GitHubError(
      `GitHub sent an unexpected body while ${action}`,
      UNUSABLE_RESPONSE_STATUS,
      'http',
    );
  }
  return body;
}

/** An empty sha is falsy, and a falsy sha turns the next write into a blind create. */
function requireSha(value: unknown, action: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GitHubError(
      `GitHub returned no file sha while ${action}; continuing would risk a blind overwrite`,
      UNUSABLE_RESPONSE_STATUS,
      'http',
    );
  }
  return value;
}

// ============================================================================
// Write serialization — one Web Lock, or a promise chain where it is absent
// ============================================================================

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

let pushChain: Promise<void> = Promise.resolve();

/**
 * Why a write to the data repo failed, for anything that shows backup health.
 *
 * Without this the status line learns of a failed flush only when it next
 * re-reads IndexedDB, which is many times longer than a flush cycle: the owner
 * is told their data is safe while it is not. A plain callback list keeps this
 * side of the module honest — no store, no React, nothing to clean up — and a
 * listener that throws cannot disturb the push it is watching.
 */
export interface PushFailure {
  /** What GitHub said, or null when the failure was not GitHub's to report. */
  kind: GitHubErrorKind | null;
  /** How long GitHub asked us to wait, when it said so. */
  retryAfterMs: number | null;
}

const pushFailureListeners = new Set<(failure: PushFailure) => void>();

/** Watch every failed write to the data repo. Returns the unsubscribe. */
export function onPushFailure(listener: (failure: PushFailure) => void): () => void {
  pushFailureListeners.add(listener);
  return () => {
    pushFailureListeners.delete(listener);
  };
}

function reportPushFailure(error: unknown): void {
  const failure: PushFailure =
    error instanceof GitHubError
      ? { kind: error.kind, retryAfterMs: error.retryAfterMs ?? null }
      : { kind: null, retryAfterMs: null };
  for (const listener of pushFailureListeners) {
    try {
      listener(failure);
    } catch {
      // A watcher's problem is not the push's problem.
    }
  }
}

function lockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as unknown as { locks?: LockManagerLike }).locks;
  if (!candidate || typeof candidate.request !== 'function') return null;
  return candidate;
}

function withPushLock<T>(run: () => Promise<T>): Promise<T> {
  const manager = lockManager();
  let result: Promise<T>;
  if (manager) {
    result = manager.request(PUSH_LOCK_NAME, run);
  } else {
    result = pushChain.then(run);
    pushChain = result.then(
      () => undefined,
      () => undefined,
    );
  }
  // Observed, never intercepted: the caller still sees the rejection it would
  // have seen, and a failure with no watcher is still nobody's unhandled one.
  result.then(undefined, reportPushFailure);
  return result;
}

// ============================================================================
// API
// ============================================================================

/** The file the write probe aims at. It already exists; the probe never writes it. */
const ACCESS_PROBE_PATH = `${JOURNAL_DIR}/.gitkeep`;

/**
 * A blob sha no file can have. Its only job is to guarantee the probe write
 * loses its own conflict check, so GitHub answers with a verdict and commits
 * nothing. Never use it for a real write.
 */
const IMPOSSIBLE_SHA = '0000000000000000000000000000000000000000';

/** GitHub got as far as comparing the sha, so the token may write. */
const PROBE_WRITABLE_STATUS = 409;

/** GitHub refused before the sha was looked at, so the token may not write. */
const PROBE_BLOCKED_STATUS = 403;

const RATE_LIMITED_REASON = "github's rate limit — the token is fine, try again shortly";

const UNREACHABLE_REASON = 'could not reach github — check the connection';

/**
 * Does this token actually hold write permission?
 *
 * `permissions.push` on the repo body does NOT answer that, and reading it was
 * the bug this replaces: `permissions` reports the authenticated *user's* role
 * on the repository, not the token's grant. On a repo the owner owns it comes
 * back `push: true` for every token, a Contents:read-only PAT included
 * (measured against the owner's real PAT), so the check could not fail and the
 * button was worthless — while catching exactly that token is its whole point.
 *
 * The only thing that answers is attempting a write, so this attempts one that
 * cannot land. The sha it sends matches nothing, so a token that may write is
 * turned away at the conflict check (409) having written nothing, and a token
 * that may not is turned away earlier, on permission (403). The verdict is the
 * status code alone; the message GitHub sends with it is never read. Any other
 * status is "could not confirm", never a pass.
 *
 * No push lock, deliberately: the probe writes nothing, and a failed verify is
 * not a failed backup, so it must not be reported as one.
 */
async function probeWriteAccess(token: string): Promise<AccessResult> {
  let response: Response;
  try {
    response = await call(token, contentsPath(ACCESS_PROBE_PATH), {
      method: 'PUT',
      body: {
        message: `meridian: verify write access to ${ACCESS_PROBE_PATH}`,
        content: toBase64(''),
        sha: IMPOSSIBLE_SHA,
      },
    });
  } catch {
    return { ok: false, reason: UNREACHABLE_REASON };
  }

  if (classify(response, 'PUT') === 'ratelimit') return { ok: false, reason: RATE_LIMITED_REASON };
  if (response.status === PROBE_WRITABLE_STATUS) return { ok: true };
  if (response.status === PROBE_BLOCKED_STATUS) {
    return {
      ok: false,
      reason: `the token is read-only — it needs contents read and write on ${GITHUB_OWNER}/${GITHUB_REPO}`,
    };
  }
  // The probe cannot run without its target, and the answer to a missing target
  // is never to create it: that would be the write this check refuses to make.
  if (response.status === 404) {
    return {
      ok: false,
      reason: `could not confirm write access: ${ACCESS_PROBE_PATH} is missing from ${GITHUB_OWNER}/${GITHUB_REPO}`,
    };
  }
  return { ok: false, reason: `could not confirm write access: github returned http ${response.status}` };
}

export async function verifyAccess(token: string): Promise<AccessResult> {
  let response: Response;
  try {
    response = await call(token, `/repos/${GITHUB_OWNER}/${GITHUB_REPO}`);
  } catch {
    return { ok: false, reason: UNREACHABLE_REASON };
  }

  // A 200 only proves the token can read. Write permission is a separate
  // question, and only the probe answers it.
  if (response.ok) return probeWriteAccess(token);

  const kind = classify(response, 'GET');
  if (kind === 'ratelimit') {
    return { ok: false, reason: RATE_LIMITED_REASON };
  }
  if (kind === 'auth') {
    return { ok: false, reason: `github rejected the token — it needs contents read and write on ${GITHUB_OWNER}/${GITHUB_REPO}` };
  }
  if (response.status === 404) {
    return { ok: false, reason: `${GITHUB_OWNER}/${GITHUB_REPO} is not visible to this token` };
  }
  return { ok: false, reason: `github returned http ${response.status}` };
}

/**
 * The closed set a device id may be drawn from: the eight lowercase hex
 * characters `db.ts` mints them from.
 *
 * A device id is not decoration — it becomes the middle field of
 * `YYYY-MM.<device>.jsonl`. A dot inside it produces a four-part name that
 * `parseJournalName` below skips, so the file is written, the device looks
 * backed up, and a cold restore never reads a line of it; a slash nests it in
 * a subdirectory the listing does not descend into. Both lose data in silence,
 * so an id outside this set is refused before it can ever name a file.
 */
const DEVICE_ID_ALPHABET = '0123456789abcdef';
const DEVICE_ID_LENGTH = 8;

export function isJournalDeviceId(value: string): boolean {
  if (value.length !== DEVICE_ID_LENGTH) return false;
  for (const character of value) {
    if (!DEVICE_ID_ALPHABET.includes(character)) return false;
  }
  return true;
}

/** `YYYY-MM.<device>.jsonl` → month + device. Anything else is not a journal. */
function parseJournalName(name: string): { month: string; device: string } | null {
  const parts = name.split('.');
  if (parts.length !== 3) return null;
  const month = parts[0];
  const device = parts[1];
  const extension = parts[2];
  if (extension !== JOURNAL_EXTENSION) return null;
  if (month.length === 0 || device.length === 0) return null;
  return { month, device };
}

interface ContentsEntry {
  name?: string;
  path?: string;
  sha?: string;
  type?: string;
}

export async function listJournal(token: string): Promise<JournalFile[]> {
  const action = 'listing the journal directory';
  const response = await call(token, contentsPath(JOURNAL_DIR));
  // 404: no journal directory yet. 409 on a GET: the repository has no commits yet.
  if (response.status === 404 || response.status === 409) return [];
  if (!response.ok) throw failure(response, 'GET', action);

  const body = await readJson(response, action);
  if (!Array.isArray(body)) {
    // Reporting [] here is indistinguishable from "the remote has no journals",
    // which during a sync is a dangerous thing to believe.
    throw new GitHubError(
      `GitHub sent a directory body that is not a list while ${action}`,
      UNUSABLE_RESPONSE_STATUS,
      'http',
    );
  }

  const files: JournalFile[] = [];
  for (const entry of body as ContentsEntry[]) {
    if (entry.type !== 'file') continue;
    const name = entry.name ?? '';
    const parsed = parseJournalName(name);
    if (!parsed) continue;
    files.push({
      path: entry.path ?? `${JOURNAL_DIR}/${name}`,
      name,
      sha: requireSha(entry.sha, action),
      device: parsed.device,
      month: parsed.month,
    });
  }
  return files;
}

interface FileResponse {
  content?: string;
  encoding?: string;
  sha?: string;
}

export async function getFile(token: string, path: string): Promise<FileContent | null> {
  const action = `reading ${path}`;
  const response = await call(token, contentsPath(path));
  // 404: no such file. 409 on a GET: the repository has no commits, so no file either.
  if (response.status === 404 || response.status === 409) return null;
  if (!response.ok) throw failure(response, 'GET', action);

  const body = (await readJson(response, action)) as FileResponse;
  if (body.encoding !== 'base64') {
    // Files over 1 MB come back with encoding "none" and no content. Failing
    // loudly beats handing back empty text that an append would then overwrite.
    throw new GitHubError(
      `GitHub returned ${path} with encoding "${body.encoding ?? 'unknown'}", which this client cannot read`,
      TOO_LARGE_STATUS,
      'http',
    );
  }
  return { text: fromBase64(body.content ?? ''), sha: requireSha(body.sha, action) };
}

async function putFileRaw(token: string, path: string, text: string, sha: string | null): Promise<PutResult> {
  const action = `writing ${path}`;
  const body: Record<string, unknown> = {
    message: `meridian: update ${path}`,
    content: toBase64(text),
  };
  if (sha) body.sha = sha;

  const response = await call(token, contentsPath(path), { method: 'PUT', body });
  if (!response.ok) throw failure(response, 'PUT', action);

  const parsed = (await readJson(response, action)) as { content?: { sha?: string } };
  return { sha: requireSha(parsed.content?.sha, action) };
}

export function putFile(token: string, path: string, text: string, sha: string | null): Promise<PutResult> {
  return withPushLock(() => putFileRaw(token, path, text, sha));
}

/** Exactly one trailing newline, and no blank line where the file already ended in one. */
function appendTo(existing: string, lines: string[]): string {
  const addition = lines.map((line) => `${line}\n`).join('');
  if (existing.length === 0) return addition;
  return existing.endsWith('\n') ? `${existing}${addition}` : `${existing}\n${addition}`;
}

/**
 * The journal is append-only and never compacted, so a line carrying its own
 * newline lands as two physical lines that stay unparseable forever. Refuse it
 * before anything reaches the network.
 */
function assertAppendable(lines: string[], path: string): void {
  for (const line of lines) {
    if (line.length === 0) {
      throw new GitHubError(`Refusing to append an empty line to ${path}`, INVALID_LINE_STATUS, 'http');
    }
    if (line.includes('\n') || line.includes('\r')) {
      throw new GitHubError(
        `Refusing to append a line containing a line break to ${path}`,
        INVALID_LINE_STATUS,
        'http',
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff for retry number `index` (0-based), never shorter than what GitHub asked for. */
function retryDelay(index: number, conflict: GitHubError | null): number {
  const base = RETRY_BACKOFF_MS[Math.min(index, RETRY_BACKOFF_MS.length - 1)];
  const jittered = base + Math.floor(Math.random() * base * RETRY_JITTER);
  const asked = conflict?.retryAfterMs;
  if (asked === undefined) return jittered;
  return Math.min(Math.max(asked, jittered), MAX_RETRY_DELAY_MS);
}

async function appendOnce(token: string, path: string, lines: string[]): Promise<PutResult> {
  const current = await getFile(token, path);
  const next = appendTo(current === null ? '' : current.text, lines);
  return putFileRaw(token, path, next, current === null ? null : current.sha);
}

/** Returns null when there is nothing to append — no request is made at all. */
export async function appendLines(token: string, path: string, lines: string[]): Promise<PutResult | null> {
  if (lines.length === 0) return null;
  assertAppendable(lines, path);

  return withPushLock(async () => {
    let lastConflict: GitHubError | null = null;
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(retryDelay(attempt - 1, lastConflict));
      try {
        return await appendOnce(token, path, lines);
      } catch (error) {
        if (error instanceof GitHubError && error.kind === 'conflict') {
          lastConflict = error;
          continue;
        }
        throw error;
      }
    }
    throw new GitHubError(
      `Could not append to ${path}: GitHub reported a conflicting write on ${MAX_APPEND_ATTEMPTS} consecutive attempts`,
      lastConflict === null ? 409 : lastConflict.status,
      'conflict',
    );
  });
}
