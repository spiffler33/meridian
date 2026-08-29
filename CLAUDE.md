# Meridian

Single-user personal cockpit: iPhone home-screen PWA + laptop browser. React 19 · TS · Vite 5 · Tailwind. No backend.

**GitHub is the durable store; IndexedDB is the working copy.** Every state change is an append-only journal event in the private repo `spiffler33/meridian-data`; the app folds them locally, opens instantly offline, and syncs in the background.

Code: `src/lib/` — `journal.ts` (event model + fold, pure) · `db.ts` · `github.ts` · `entities.ts` · `sync.ts`. `src/services/data.ts` is the app data API.

## Event shape

One JSON object per line. Seven fields:

| field | type | notes |
|---|---|---|
| `id` | string (UUID) | dedupe key, and the final tiebreak in the fold order |
| `device` | string | short id minted on first run, editable in Settings |
| `seq` | number | per-device monotonic counter, committed before it is handed out |
| `ts` | number | epoch ms at write time (`Date.now()`) |
| `type` | `'upsert' \| 'delete'` | discriminant |
| `entity` | string | one of twelve, see `ENTITY` |
| `entityId` | string | |
| `fields` | object | **required on an upsert, forbidden on a delete** |

`JournalEvent` is discriminated on `type`: an upsert without `fields` is a compile error, not a runtime drop. In `fields`, an explicit `undefined` means **no write** (skipped — `JSON.stringify` erases it, so the record would not round-trip); `null` is a real value meaning **clear**.

Twelve entities: profile · habit · dailyEntry · habitCompletion · task · yearTheme · towerItem · pack · packSession · readItem · pulse · pulseVocab — the last three grown here, with no export behind them: `readItem` is read-state, its entity id **being** the natural key `<surface>:<itemKey>`; `pulse` is the capture primitive, one utterance; `pulseVocab` is the coder's vocabulary, a singleton under one fixed id. No `user_id` — no owner concept locally. Three were keyed in Postgres by a composite unique constraint, so locally the entity id **is** that natural key (dailyEntry: date; habitCompletion: habit+date; yearTheme: year); `resolveEntityId` adopts a seeded row's id when one already holds the key.

## Fold rule

Order key: **`(ts, device, seq, id)`** — four parts, ascending, plain code-unit comparison (never locale-aware; every replica must agree).

**Never reduce it to three.** `(ts, device, seq)` is not a total order: a seq reset (Safari evicts site data after 7 idle days), a restored backup, or a reused device id all produce real ties, and a tie resolved by array position makes the winner depend on fetch order. Review found two devices diverging permanently, and an entity surviving its own delete. `id` makes it total.

- **Field-level last-writer-wins** per `(entity, entityId)`. Different fields from two devices both survive, merged.
- **A delete is a tombstone**: it clears every field written before it.
- **An upsert newer than a delete resurrects the entity**, carrying only the fields written after that delete. Intended: deletes are compared per field, not as a whole-record flag.
- **Dedupe by event id.** Identical re-delivery from overlapping fetches is silent — the normal path. The same id with *different* content warns; the first in event order wins.
- Field values are **deep-copied**. Folded state shares no leaf with the events or with another fold; mutate it freely.
- **An entity bucket is ABSENT, not empty, when nothing survives.** A fresh device folds to `{}`. Read defensively via `bucket()` (entities.ts), the one place `?? {}` lives; unguarded `Object.values(state.habit)` throws on the airplane-mode cold open.
- Bad input never throws: `parseJournalLines` and `fold` skip the line and return `warnings[]`. A crash on one bad line would take all state with it.
- The two last-writer guards inside `fold` are unreachable given the pre-sort plus a total order, kept as belt and braces. They go live if an event is ever applied **incrementally** to folded state — then go through `fold`, never hand-assign a field.

## Repo layout

`spiffler33/meridian-data`, private:

| path | what |
|---|---|
| `journal/YYYY-MM.<device>.jsonl` | the journal — one JSON event per line |
| `journal/2026-01.seed.jsonl` | 303-event origin seed, device `seed`, dated to its source data |
| `exports/supabase-2026-08/` | one-time origin export, 11 table JSONs. Reference only. |
| `snapshot.json` | spec allows a non-authoritative restore cache. **Not implemented** — nothing reads or writes one; never make it authoritative. |

- **NO COMPACTION, EVER.** Never rewrite, merge, or prune a journal file.
- A device appends **only to its own current-month file**, at a path taken from **append time**, not the event's `ts` (`journalPathFor(device, appendedAt)`): a backlog draining weeks late would otherwise land in a month no warm device fetches again. The line carries its own `ts` and the fold orders by that, so history is right wherever it sits. Months are UTC.
- App repo: work lands on `local-first`; **pushing `main` deploys the live site** (meridian.spiffler.xyz via Pages).

## Read paths

| open | fetches |
|---|---|
| **COLD** — no cached state, or no cached files | **every file `listJournal` returns** |
| **WARM** — state already cached | current + previous month, for every device |

Cold takes everything because `snapshot.json` is never authoritative, so the warm window alone would silently lose everything older than two months on a fresh device — the mandatory restore drill, and the only reason the January seed is reachable. Warm is safe: older months cannot change. Unchanged files cost nothing — the sha is in the listing.

After fetched files land in the cache, `resetSession()` must run or the pre-fetch fold serves that tab for life. `syncDown` does it on both paths.

## Flush triggers

Push = drain the outbox into the journal.

1. **~5 s debounce after the last edit** — `FLUSH_DEBOUNCE_MS = 5000`, `scheduleFlush()`; a burst collapses into one request.
2. **`visibilitychange`** — push always, plus a pull when becoming visible.
3. **`pagehide`** — best effort; what misses stays queued.
4. **foreground (`focus`)** — push, then pull.

The outbox is what makes an app kill safe: events are enqueued **before** the in-memory session is touched, and a failed push leaves the outbox intact minus only what GitHub accepted, never advancing `lastBackupAt`.

**Push runs before pull, and never concurrently** — both go through one queue in `sync.ts`. Concurrently, a pull reads the remote file before the push appends, then writes that stale text into the cache and drops the session: the edit just made vanishes until the next foreground.

Writes are SHA-conditional, retried on a 409 (3 attempts, jittered backoff, capped at 5 s), serialized across tabs under one Web Locks name (`meridian-github-push`; promise chain as fallback), idempotent because the fold dedupes by id, and aborted at 30 s. Branch on `GitHubError.kind` (`auth | ratelimit | conflict | network | http`), **never on `status`** — 502/413/400 are synthetic statuses GitHub never sent. On `ratelimit` the red state must not tell the owner to revoke the PAT; the token is fine.

Failure is always visible: "Last backed up <relative time> from this device", and a failed push becomes a persistent red state with retry. Silent failure is a bug.

## Token handling

A **fine-grained PAT**: single repo `meridian-data`, **Contents: read and write**, no expiration. Entered in Settings.

- It lives **only** in the IndexedDB `meta` store under `token`. Never in source, a bundle, an env file, a commit, a log, a URL, or an error message. `github.ts` takes it as a parameter and stores nothing.
- `verifyAccess` proves write access by attempting a write that cannot land: `PUT journal/.gitkeep` carrying a `sha` of forty zeros. **409 = writable** (GitHub reached the sha check, and the sha guarantees nothing was committed), **403 = not writable**, any other status = could not confirm. Status code only, never the message text. It takes no push lock: a failed verify is not a failed backup.
- Never "simplify" that back to reading `permissions.push` off the repo body. Measured against the owner's real PAT: `permissions` reports the authenticated **user's role on the repo**, not the token's grant, so it returns `push: true` for a Contents:read-only PAT on a repo the owner owns. The check then cannot fail, and that is exactly the token the button exists to catch.
- The Claude API key is a separate device-local `meta` key (`claudeApiKey`). `meta` is never journalled, which is why secrets may live there.

## Local layer

IndexedDB `meridian` v1, four stores:

| store | holds |
|---|---|
| `state` | folded state under key `current` — a read shortcut, not the record |
| `journalCache` | fetched journal files by path (`text`, `sha`, `fetchedAt`) |
| `outbox` | unpushed events, keyed by `id`, indexed `bySeq` |
| `meta` | deviceId · seq · token · claudeApiKey · lastBackupAt · lastBackupError(+Kind) · lastStateError · theme · skippedContextPrompt · persistGranted |

`nextSeq()` commits the incremented counter in one strict transaction before returning it — two events sharing a seq corrupt the fold order. `getDeviceId()` reads and creates in one transaction for the same reason.

First paint reads IndexedDB and never awaits the network. `navigator.storage.persist()` runs at startup; its answer shows in Settings.

## Known limitations — deliberately unfixed

1. **Device clock skew beats last-writer-wins.** `ts` is wall-clock and the fold orders by `ts` first, so a phone running 10 minutes slow silently loses a genuinely later edit to an older desktop one. Fix = a hybrid logical clock (`max(seenTs, now) + 1`), which changes the event contract — a decision, not a patch.
2. **A device-month journal over 1 MB stops syncing** until the month rolls over: above 1 MB the contents API returns `encoding: "none"` with no content, and `getFile` throws rather than return empty text an append would overwrite the file with. Do **not** "fix" it by returning `''`. Fix = the blobs read path; years away at the observed rate.
3. **The duplicate-natural-key merge is row-granular.** In a duplicate-key group an unrelated write to one record makes all its fields newer, so it can overwrite the other's. Fix needs the fold's per-field timestamps — same family as (1).
4. **Cross-tab staleness.** Each tab memoises its own session; a write in one is invisible to the other until it resets. Survivable (duplicates merge); a BroadcastChannel nudge calling `resetSession()` closes it.

## Hard fences

- **No regex, no keyword lists, no string-pattern heuristics in shipped logic.** `JSON.parse` and splitting a machine-defined filename are fine; rules over natural language never are.
- **No browser localStorage — IndexedDB only.** `grep -rn "localStorage" src/` must stay `0` — that counts comments and names.
- **No third-party CDN**, no external script, style, or font. Bundle everything. CSP `connect-src` is exactly `'self' https://api.github.com https://api.anthropic.com`; `script-src 'self'`.
- **No new services.** GitHub plus the browser: no server, no accounts, no realtime.
- **Secrets never reach source, a bundle, a committed env file, a log, or an error.** Data sits plaintext in a private repo — accepted; do not add encryption.
- `tsconfig.app.json` sets `erasableSyntaxOnly: true`: no TS parameter properties, no enums.
- **AI is on life support** pending a deliberate rebuild. `parseTowerInput` is now only its local fallback; `claude.ts` is unchanged except its key source. Invest nothing in AI quality — leave the seams obvious.

## Commands

`npm test -- --run` · `npm run build` · `npx tsc -b` · `npm run lint`

One that hangs forever right after an `npm install` is this machine's Node 25 `dlopen` deadlock on `node_modules/@rollup/rollup-darwin-arm64/rollup.darwin-arm64.node`, not a corrupt install: symlink that path to a renamed copy. No postinstall hook.

## History

Ran on Supabase (auth, Postgres, an edge function) until removed entirely in 2026-08; `exports/supabase-2026-08/` is the export it left behind.
