MERIDIAN LOCAL-FIRST REWORK — IMPLEMENTATION BRIEF

You are rebuilding Meridian's data layer. Architectural decisions are final; implement verbatim. If anything below is impossible or contradicts the codebase, STOP and ask — do not substitute your own design. Keep the existing React UI; replace only storage, sync, and backend usage.

CONTEXT
Meridian is a single-user personal cockpit used on an iPhone (as a home-screen PWA) and a laptop browser. Its Supabase free-tier backend pauses on inactivity; we are eliminating the server entirely. Target: app opens instantly offline from local data; a private GitHub repo is the durable store and the phone↔laptop carrier. GitHub is the source of truth for recovery; IndexedDB is the working copy.

---

## SPEC — unchanged, normative for every phase below

DATA MODEL — EVENT JOURNAL
- All state changes are events with fields: `id` (UUID), `device` (short id chosen at first run, editable in Settings), `seq` (per-device monotonic counter, persisted locally), `ts` (epoch ms), `type` ("upsert" | "delete"), `entity`, `entityId`, `fields` (partial object; absent for delete).
- Journals live in the data repo at `journal/YYYY-MM.<device>.jsonl` — one JSON object per line. Each device appends ONLY to its own current-month file. A new month means a new file; there is NO compaction step, ever.
- Rebuilding state = fetch journals, sort events by **(ts, device, seq, id)**, apply field-level last-writer-wins per (entity, entityId); a delete is a tombstone beating older upserts; dedupe by event id; skip unparseable lines and surface a visible warning instead of crashing.
  - **AMENDMENT 2026-08-23 (orchestrator, owner asleep, in-scope):** the original spec's `(ts, device, seq)` is NOT a total order. Adversarial review reproduced two devices converging on *different* state depending on journal fetch order, and a tied upsert-vs-delete letting an entity survive its own delete. Ties are reachable via a seq counter reset (Safari evicts site data after 7 idle days), a restored backup, or a reused device id. Appending `id` as a final tiebreak makes the order total and fetch-order-independent. This is a strict refinement — it changes nothing where the original triple already discriminated.
- `snapshot.json` in the repo is an optional derived cache for fast restore. It is never authoritative; on any doubt, replay journals.

LOCAL LAYER
- IndexedDB holds: current folded state, cached copies of all fetched journal files, the outbox of unpushed events, device id, seq counter, and the token. Never use localStorage for anything.
- First paint always renders from IndexedDB; network sync runs in the background with a subtle status indicator. The app must be fully usable in airplane mode.
- Call `navigator.storage.persist()` at startup and show its result in Settings. Settings must also instruct/install-prompt home-screen installation on iOS and explain that browser storage is the convenience copy, GitHub the durable one.

GITHUB SYNC
- All writes go through the GitHub contents API against `meridian-data`, SHA-conditional; on a 409/SHA mismatch, refetch and retry; serialize pushes with the Web Locks API so two tabs cannot race. Pushes are idempotent because folding dedupes by event id.
- Flush the outbox: ~5 s after the last edit, on `visibilitychange`/`pagehide`, and on app foreground. Unflushed events must survive app kill via the outbox.
- Reads on open: list the journal directory, fetch current + previous month for every device id seen, plus `snapshot.json`; update the IndexedDB journal cache.
  - **AMENDMENT 2026-08-23 (orchestrator, owner asleep, in-scope):** current+previous-month is correct for a WARM open only. On a COLD restore — IndexedDB empty, which is exactly acceptance test D, the mandatory restore drill — that rule makes every journal file older than two months unreachable, so the restore would silently return partial history. Since `snapshot.json` is explicitly never authoritative, a cold restore MUST fetch every journal file the directory lists. Warm opens keep the cheap current+previous path. Phase 7 implements both paths; Phase 5's seed file is dated to its source data (`journal/2026-01.seed.jsonl`) and is reachable only because of this amendment.
- Auth: a fine-grained PAT (single repo: `meridian-data`; permission: Contents read/write; no expiration) entered by the user on a Settings screen with a "Verify access" button. The token lives only in IndexedDB. It must never appear in source, bundle, env files, or any commit.
- Failure visibility: the UI always shows "Last backed up <relative time> from this device"; a failed push turns this into a persistent red state with a retry action. Silent failure is a bug.

SECURITY
- Zero third-party scripts and zero CDN loads — bundle everything. Strict CSP meta tag (exact `connect-src` fixed by DECISION 1 below).
- Data is stored plaintext in a private repo — confirmed acceptable for this content. Do not add encryption.

NON-GOALS
No accounts, no realtime, no server, no new services, no framework changes, no schema redesign beyond mapping existing tables to entities.

---

## GROUND TRUTH — surveyed 2026-08-23, do not re-derive

**Live Supabase**: project `ylahwscmtdzumyfyzctr`, currently UP. Anon key cannot read any table (RLS on `auth.uid() = user_id`). Export requires an authenticated credential — see Phase 0.

**11 tables.** PK is `id uuid` on all. Only 3 have migrations in-repo; the other 8 exist only in `src/types/database.ts` + live state.

| Table | Shape | Live rows (2026-08-23) | Ported? |
|---|---|---|---|
| `profiles` | 1 row per account | **4** | yes → `profile` (see DECISION 6) |
| `habits` | collection, soft-delete via `archived_at` | 43 | yes |
| `daily_entries` | per user+date | 13 | yes |
| `habit_completions` | per user+habit+date | 219 | yes |
| `tasks` | per user+date+category | **0** | yes (schema only, no rows) |
| `year_themes` | per user+year | 2 | yes |
| `tower_items` | collection | 156 | yes |
| `packs` | collection, soft-delete via `archived_at` | 3 | yes |
| `pack_sessions` | per pack+date | 18 | yes |
| `friendships` | collection | **0** | **NO — dead code, zero app references** |
| `activities` | collection | **0** | **NO — dead code, zero app references** |

**The database is multi-user.** Four accounts exist; row ownership:

| user_id | username | habits | daily_entries | completions | year_themes | tower_items | packs |
|---|---|---|---|---|---|---|---|
| `ba1d1269-…1cfb17` | **vats** | 12 | 9 | 176 | 1 | 84 | 2 |
| `1e5dd182-…f73a79` | testuser | 11 | 3 | 42 | 1 | 70 | 1 |
| `cb271a36-…1f07e6b47` | mingz | 10 | 0 | 0 | 0 | 0 | 0 |
| `b6ba2804-…d05811a` | mansi | 10 | 1 | 1 | 0 | 2 | 0 |

Phase 0 exports **all** rows regardless of owner. Phase 5 seeds only the profile(s) named in DECISION 6.

`friendships` and `activities` are exported in Phase 0 for the record and NOT mapped to entities. Decided, not open.

**`src/services/data.ts`** exports ~35 functions across those tables. Port every signature unchanged. Three carry non-obvious behaviour:
- `getPacks()` uses a Postgres embedded aggregate `select('*, pack_sessions(count)')` — needs manual cross-store counting locally.
- `getTowerItems()` / `getTowerItemsByStatus()` order by `expects_by ASC NULLS LAST, last_touched ASC` — the surfacing algorithm depends on this exact order.
- `createHabit()` / `createTask()` read max `sort_order` then insert (a TOCTOU race against Postgres). Locally this collapses to a single-threaded read-then-append; keep the resulting order identical.
- The four `pack_sessions` functions currently carry no `user_id` filter and lean on RLS through the parent FK. IndexedDB has no RLS; single-user makes this moot, but do not treat it as a scoping guarantee.

**Auth today**: real Supabase Auth. `usernameToEmail()` maps a username to `<username>@stoicuser.mailinator.com` and does email+password sign-in. `AuthContext` gates the **entire app** in `src/App.tsx` (`LoadingScreen` → `AuthScreen` → `AppProvider`). Only `ThemeProvider` sits outside the gate.

**AI today**, two unrelated paths:
- `src/services/ai.ts` → `supabase.functions.invoke('parse-task')` → edge function → `api.anthropic.com`. Dies with Supabase. It already has a local no-AI fallback (`{ text: trimmed, status: 'active' }`), so the Tower brain-dump degrades cleanly.
- `src/services/claude.ts` → **browser calls `https://api.anthropic.com/v1/messages` directly** (`anthropic-dangerous-direct-browser-access`), model `claude-3-haiku-20240307`, using the user's own key read from `profiles.claude_api_key`. Survives Supabase removal only if the key moves to IndexedDB and CSP permits the host.

**localStorage today** (must all go, per spec): `src/store/ThemeContext.tsx:42,49` key `meridian-theme`; `src/components/AiInsight.tsx:47,94` key `hasSkippedContextPrompt`.

**PWA today**: none. No `manifest.webmanifest`, no service worker, no CSP meta. `index.html` has iOS `apple-mobile-web-app-*` meta tags only. `public/` holds just `CNAME` (meridian.spiffler.xyz) and `vite.svg`. **A browser-loaded page with no service worker cannot cold-open offline** — acceptance test A is unreachable without one. Phase 9 closes that gap.

**Deploy**: `.github/workflows/deploy.yml` → Pages, injecting `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from repo secrets at build. Both must be stripped in Phase 10.

**Test infra today**: none. No test script, no runner, no test files. Phase 1 installs it.

---

## DECISIONS — ratified before the run; phases implement these verbatim

**DECISION 1 — AI is on life support; full rebuild is a LATER plan.** Ratified 2026-08-23: do the bare minimum to keep the app coherent, invest nothing in AI quality now.
- `src/services/ai.ts` `parseTowerInput()` — delete the `supabase.functions.invoke('parse-task')` call; its existing local fallback (`{ text: trimmed, status: 'active' }`) becomes its only behaviour. The Tower brain-dump keeps working, just without parsing.
- `src/services/claude.ts` — unchanged logic. Only the key source moves: `loadApiKey()` reads from the IndexedDB `meta` store instead of `profiles.claude_api_key`. Smallest possible diff; do not redesign, do not add retries, do not change the model.
- The existing API-key field in `SettingsView` is repointed at IndexedDB. No new AI UI.
- CSP `connect-src` is therefore exactly: `'self' https://api.github.com https://api.anthropic.com`. `script-src 'self'`.
- **Out of scope for this run**: any improvement to insight quality, prompt, model choice, or bringing back server-side parsing. Leave the seams obvious for the later rebuild.

**DECISION 2 — Auth is removed entirely.** No login screen; the app opens straight to Today. Delete `src/services/auth.ts`, `src/store/AuthContext.tsx`, `src/components/AuthScreen.tsx`. `LoadingScreen` is kept only if the IndexedDB first-paint needs it. Safe on public Pages: no data is served by the origin — a stranger loading the URL gets an empty local app and cannot fetch anything without the PAT.

**DECISION 3 — Offline shell via `vite-plugin-pwa`.** Added as a devDependency; its output is self-contained (no CDN, no runtime third-party script), which is what the SECURITY fence actually forbids. Generates `manifest.webmanifest` + a precache service worker over Vite's hashed assets. Hand-rolling precache against hashed filenames is the alternative and is strictly worse.

**DECISION 4 — Test harness is `vitest` + `fake-indexeddb`, devDependencies.** Acceptance tests C and F become unit tests over the fold; A, B, D, E stay manual and are fenced in Phase 12.

**DECISION 5 — Export credential.** A Supabase **secret key** (`sb_secret_…`) is stored in `.env.local` as `SUPABASE_SECRET_KEY` (gitignored, no `VITE_` prefix so it can never be bundled). It bypasses RLS, so the export reads every row of every table regardless of owner. Verified working 2026-08-23.

> **SECURITY DEBT — act on this.** The key was pasted into a chat transcript. Rotate it in the Supabase dashboard as soon as Phase 0 has produced a verified export, and before the project is left idle. Tracked as the first item in "After the run".

**DECISION 6 — Seed `vats` only.** Ratified 2026-08-23: `ba1d1269-aa10-436b-bb42-c784c1fcbf17`. `testuser`, `mingz` and `mansi` are exported in Phase 0 for the record and are NOT seeded.
Phase 5 target counts, pre-registered: habits 12 · daily_entries 9 · habit_completions 176 · tasks 0 · year_themes 1 · tower_items 84 · packs 2 · pack_sessions 18 (all 18 belong to vats-owned packs — verified) · profile 1.

**DECISION 8 — Every phase runs on Opus. No Sonnet anywhere in this run.** Owner override, ratified 2026-08-23, superseding the standing Sonnet-default tiering rule in `~/.claude/CLAUDE.md` for this run only. The verification ladder is unchanged: a bigger coder does not waive the independent re-run, and seam-design phases still get the adversarial diff review.

**DECISION 7 — All work lands on branch `local-first`, never `main`.** `.github/workflows/deploy.yml` fires on push to `main` and would deploy a half-migrated app over the live meridian.spiffler.xyz that is in daily use. Phase commits stay on the branch; the branch is pushed (safe — no workflow trigger); `main` is merged only after the Phase 12 acceptance drill passes.

---

## PHASES

### Phase 0 — Export Supabase and stand up `meridian-data` — HUMAN-GATED
**Goal**: every row of all 11 tables safely in a private repo before a line of app code changes.
**Scope**: scratchpad export script; new private repo `spiffler33/meridian-data`; nothing in this repo changes.
**Human gate**: explicit go-ahead to create the private repo `spiffler33/meridian-data`. The credential half is already satisfied (DECISION 5, verified).
**Steps**
1. Read `SUPABASE_SECRET_KEY` from `.env.local`; never print it, never write it to any output file.
2. For each of the 11 tables, paginate `GET /rest/v1/<table>?select=*` (page size 1000) and write `exports/supabase-2026-08/<table>.json`.
3. For each table, record the `Content-Range` total from a `Prefer: count=exact`, `Range: 0-0` request as the authoritative live count.
4. `gh repo create spiffler33/meridian-data --private`; commit the 11 files plus `exports/supabase-2026-08/counts.json`.
**Done-criteria**
- Script prints a table of `<table>: <exported> / <live>` for all 11 tables → every pair equal, exit 0.
- `gh api repos/spiffler33/meridian-data/contents/exports/supabase-2026-08 --jq 'length'` → `12`.
- `git -C <clone> log --oneline | wc -l` → ≥ 1, tree clean.
- Counts match this pre-registered baseline exactly: profiles 4 · habits 43 · daily_entries 13 · habit_completions 219 · tasks 0 · year_themes 2 · tower_items 156 · packs 3 · pack_sessions 18 · friendships 0 · activities 0. Any drift → STOP and report, do not proceed.
- `grep -rn "sb_secret_" exports/ scripts/ 2>/dev/null | wc -l` → `0` (no credential leaked into the export or a script).
- `profiles.json` must retain `claude_api_key` values — they are user secrets. Confirm the export repo is private before pushing: `gh repo view spiffler33/meridian-data --json isPrivate --jq .isPrivate` → `true`.
`depends_on: []` · `weight: heavy` · `live_model: no` · `coder: opus` · `verify_class: complete` · `kind: recipe`
- [x] done — 2cd6554 in meridian-data; counts verified against live 2026-08-23

### Phase 1 — Test harness
**Goal**: `npm test` exists and passes, so later phases have machine-checkable criteria.
**Scope**: `package.json`, `vitest.config.ts`, `src/lib/__tests__/smoke.test.ts`
**Steps**: add `vitest` + `fake-indexeddb` devDeps; `"test": "vitest"` script; `vitest.config.ts` with `environment: 'jsdom'` and a setup file importing `fake-indexeddb/auto`; one smoke test.
**Done-criteria**: `npm test -- --run` → exit 0, ≥1 test passed. `npm run build` → exit 0.
`depends_on: []` · `weight: light` · `live_model: no` · `coder: opus` · `verify_class: complete` · `kind: recipe`
- [x] done — vitest 3.2.7 (vite-5 compatible), 2/2 pass, build+tsc clean, lint unchanged at 8 pre-existing

### Phase 2 — Journal core: event model and fold
**Goal**: the pure, dependency-free heart of the system — everything else rests on it.
**Scope**: `src/lib/journal.ts`, `src/lib/journal.test.ts` (no imports from `src/services/`, no IndexedDB, no fetch)
**Steps**: define the `JournalEvent` type per SPEC; `parseJournalLines(text)` → `{ events, warnings }`; `fold(events)` → `{ state, warnings }` implementing sort by (ts, device, seq), field-level LWW, delete-as-tombstone, dedupe by event id.
**Done-criteria** — `npm test -- --run src/lib/journal.test.ts` exit 0, with a named test for each of:
1. events sort by `ts`, ties broken by `device` then `seq`;
2. same field written twice → later (ts, device, seq) wins;
3. different fields of the same entity from two devices → both survive, merged;
4. delete beats an older upsert of the same entityId;
5. an upsert newer than a delete resurrects the entity;
6. the same event id appearing in two files is applied once;
7. an unparseable line is skipped, the rest fold correctly, and the bad line is reported in `warnings[]`.
Tests 2–5 are acceptance C; test 7 is acceptance F.
**Why opus**: the delete-vs-later-upsert precedence and the tie-break ordering are the two judgment calls in the whole rework, and a silent error here corrupts data irrecoverably rather than failing loudly.
`depends_on: [1]` · `weight: heavy` · `live_model: no` · `coder: opus` · `verify_class: complete` · `kind: seam-design`
- [x] done — 18 tests; order key now (ts,device,seq,id) after review found it non-total; deep-copy on fold

### Phase 3 — IndexedDB layer
**Goal**: the local working copy, durable across app kill.
**Scope**: `src/lib/db.ts`, `src/lib/db.test.ts`
**Steps**: one database, stores `state`, `journalCache`, `outbox`, `meta` (deviceId, seq, token, lastBackupAt, lastBackupError, skippedContextPrompt, theme). Typed accessors; `nextSeq()` persists before returning. `requestPersistence()` wrapping `navigator.storage.persist()`.
**Done-criteria**: `npm test -- --run src/lib/db.test.ts` exit 0, covering: round-trip through each store; `nextSeq()` strictly increasing across a simulated close/reopen; outbox entries survive close/reopen; `requestPersistence()` returns the boolean and never throws when the API is absent.
`depends_on: [1]` · `weight: heavy` · `live_model: no` · `coder: opus` · `verify_class: sample` · `kind: recipe`
- [x] done — 32 tests; enqueue validation, real error causes, dead-handle recovery, strict durability

### Phase 4 — GitHub contents-API sync client
**Goal**: SHA-conditional, race-safe, idempotent transport.
**Scope**: `src/lib/github.ts`, `src/lib/github.test.ts` (no IndexedDB imports — the token is passed in)
**Steps**: `listJournal()`, `getFile(path)`, `putFile(path, content, sha)`, `appendLines(path, lines)`, `verifyAccess(token)`. 409/SHA mismatch → refetch and retry (bounded). Serialize every write under one Web Locks name; fall back to an in-module promise chain where `navigator.locks` is absent.
**Done-criteria**: `npm test -- --run src/lib/github.test.ts` exit 0 with mocked `fetch`, covering: a 409 triggers exactly one refetch and the retry succeeds; a 401 surfaces a typed auth error rather than throwing raw; two concurrent `appendLines` calls to the same path issue their PUTs strictly in sequence; `listJournal` groups `YYYY-MM.<device>.jsonl` by device; the retry is bounded and gives up with a typed error.
`depends_on: [1]` · `weight: heavy` · `live_model: no` · `coder: opus` · `verify_class: sample` · `kind: recipe`
- [x] done — 38 tests; 30s abort, ratelimit vs auth, newline guard, 409-on-GET as absent

### Phase 5 — Seed journal from the Phase 0 export
**Goal**: turn the export into `journal/YYYY-MM.seed.jsonl` so a fresh device restores real history.
**Scope**: scratchpad transform script; writes into the `meridian-data` clone. No app code.
**Steps**: filter every table to the `user_id`(s) named in DECISION 6 (`pack_sessions` via its parent `packs.user_id`); map the 9 ported tables to entities; `ts` from `created_at`/`updated_at` where the source has it, else a fixed floor timestamp; `device: "seed"`; `seq` monotonic in emission order; one `upsert` event per row. Skip `friendships` and `activities`. Drop the `user_id` column itself — the local model has no owner concept.
**Done-criteria**: replay the produced file through Phase 2's `fold()` → per-entity counts exactly equal the DECISION 6 owner's row counts from the table above; `warnings[]` is empty; every line parses as JSON with all seven required event fields present; `grep -c user_id journal/*.seed.jsonl` → `0`.
`depends_on: [0, 2]` · `weight: light` · `live_model: no` · `coder: opus` · `verify_class: complete` · `kind: transcription`
- [ ] done

### Phase 6 — Domain adapter: entities and the local data API
**Goal**: `src/services/data.ts` keeps every exported signature and stops knowing Supabase exists.
**Scope**: `src/lib/entities.ts`, `src/services/data.ts`, `src/lib/entities.test.ts`
**Steps**: entity definitions for the 9 ported tables; reimplement all ~35 exports against fold-state + journal appends. Preserve exactly: `getPacks()` session counts (manual aggregation), tower ordering `expects_by ASC NULLS LAST, last_touched ASC`, `sort_order` assignment for `createHabit`/`createTask`, `updateTask`'s `completed_at` set/clear side-effect, `updateTowerItem`'s `last_touched` bump, soft-delete semantics on `habits`/`packs`.
**Done-criteria**: `npx tsc -b` exit 0; `npm test -- --run` exit 0 with tests asserting the four preserved behaviours above; `grep -c "supabase" src/services/data.ts` → `0`; every function name exported before the phase is still exported after (`node -e` diff of the export list against a pre-phase snapshot → empty).
`depends_on: [2, 3]` · `weight: heavy` · `live_model: no` · `coder: opus` · `verify_class: sample` · `kind: seam-design`
- [ ] done

### Phase 7 — Rewire the app shell
**Goal**: first paint from IndexedDB, no auth gate, outbox flushed on the right triggers.
**Scope**: `src/App.tsx`, `src/store/AppContext.tsx`, `src/store/ThemeContext.tsx`, `src/components/AiInsight.tsx`, `src/services/claude.ts`; delete `src/store/AuthContext.tsx`, `src/services/auth.ts`, `src/components/AuthScreen.tsx`
**Steps**: remove the auth gate per DECISION 2; `AppProvider` hydrates from IndexedDB before first paint and syncs in the background; wire flush triggers (~5 s debounce after last edit, `visibilitychange`, `pagehide`, foreground); call `requestPersistence()` at startup; move `meridian-theme` and `hasSkippedContextPrompt` into the `meta` store; `claude.ts` reads its key from IndexedDB.
**Standing invariants — must still hold after this phase**
- *Lifetime*: a failed sync or a killed app must leave the outbox intact and must not advance `lastBackupAt`. Walk the error path of every fetch added here.
- *Ordering*: first paint reads IndexedDB and never awaits the network; no code path renders a spinner in place of local data.
- *Pairing*: `AppContext`'s existing optimistic-update-then-revert behaviour on `toggleHabit`, `toggleMit`, `toggleHoliday` survives; each edit emits exactly one journal event, `initializedRef`'s once-only load stays once-only.
**Done-criteria**: `npx tsc -b` exit 0; `npm run build` exit 0; `npm test -- --run` exit 0; `grep -rn "localStorage" src/ | wc -l` → `0`; `grep -rn "AuthContext\|AuthScreen\|services/auth" src/ | wc -l` → `0`.
`depends_on: [6]` · `weight: heavy` · `live_model: no` · `coder: opus` · `verify_class: sample` · `kind: seam-design`
- [ ] done

### Phase 8 — Settings and backup visibility
**Goal**: the user can set the device id, paste and verify the PAT, see persistence status, and can never be silently un-backed-up.
**Scope**: `src/views/SettingsView.tsx`, `src/components/BackupStatus.tsx`, `src/components/BackupStatus.test.tsx`
**Steps**: device-id field; PAT field writing only to IndexedDB, with a "Verify access" button calling `verifyAccess()`; `navigator.storage.persist()` result displayed; iOS home-screen install instructions plus the "browser storage is the convenience copy, GitHub the durable one" explanation; always-visible "Last backed up <relative time> from this device"; failure → persistent red state with a retry action.
**Standing invariants**: the PAT never enters a log, a URL, an error message, or the DOM as plain text after entry; `SettingsView`'s existing habit CRUD (`createHabit`/`updateHabit`/`deleteHabit`) keeps working.
**Done-criteria**: `npx tsc -b` and `npm run build` exit 0; `npm test -- --run src/components/BackupStatus.test.tsx` exit 0 covering — renders a relative time when a backup succeeded; renders the persistent red state with a retry control after a failure and does not clear it on re-render; never renders a spinner in any state (acceptance E's UI half). `grep -rn "token" src/ | grep -i "console\." | wc -l` → `0`.
`depends_on: [7]` · `weight: heavy` · `live_model: no` · `coder: opus` · `verify_class: sample` · `kind: seam-design`
- [ ] done

### Phase 9 — Offline shell: manifest and service worker
**Goal**: make acceptance A physically possible.
**Scope**: `vite.config.ts`, `package.json`, `index.html`, `public/` icons
**Steps**: add `vite-plugin-pwa` (DECISION 3); generate `manifest.webmanifest` (name Meridian, standalone, theme `#fafaf9`); precache the built assets; register the SW from `main.tsx`; keep the existing iOS meta tags.
**Done-criteria**: `npm run build` exit 0; `dist/sw.js` and `dist/manifest.webmanifest` both exist; `grep -c "manifest" dist/index.html` ≥ `1`; `node -e` check that the generated precache manifest lists the hashed JS and CSS entry chunks.
`depends_on: [7]` · `weight: light` · `live_model: no` · `coder: opus` · `verify_class: complete` · `kind: recipe`
- [ ] done

### Phase 10 — CSP and Supabase removal
**Goal**: nothing named Supabase remains; the CSP is exactly as ratified.
**Scope**: `index.html`, `package.json`, `.github/workflows/deploy.yml`, `.env.local`; delete `src/services/supabase.ts`, `supabase/`; edit `src/services/ai.ts`
**Steps**: strip the `functions.invoke` path from `ai.ts` leaving its local fallback (DECISION 1); delete `src/services/supabase.ts` and the whole `supabase/` directory including the edge function and migrations; `npm uninstall @supabase/supabase-js`; remove the two `VITE_SUPABASE_*` env lines from the deploy workflow; remove them from `.env.local`; add the CSP meta tag.
**Done-criteria**
- `grep -rni "supabase" src/ index.html vite.config.ts .github/ package.json | wc -l` → `0`.
- `test -d supabase` → non-zero exit (directory gone).
- `npm run build` exit 0; `npx tsc -b` exit 0; `npm test -- --run` exit 0.
- `grep -c "connect-src 'self' https://api.github.com https://api.anthropic.com" index.html` → `1`.
- `grep -c "script-src 'self'" index.html` → `1`.
- `grep -rn "http" dist/assets/*.js | grep -oE "https://[a-z.]+" | sort -u` contains only `api.github.com` and `api.anthropic.com`.
`depends_on: [7, 9]` · `weight: light` · `live_model: no` · `coder: opus` · `verify_class: complete` · `kind: recipe`
- [ ] done

### Phase 11 — Write `./CLAUDE.md`
**Goal**: future sessions inherit the protocol without re-reading the code.
**Scope**: `CLAUDE.md` (new, this repo)
**Steps**: document event shape, the fold rule and its precedence order, repo layout of `meridian-data`, flush triggers, token handling, and the "GitHub is durable, IndexedDB is the working copy" rule.
**Done-criteria**: `CLAUDE.md` exists and contains headings for each of: Event shape · Fold rule · Repo layout · Flush triggers · Token handling. `grep -c "supabase" CLAUDE.md` → `0` except within an explicit "removed 2026-08" historical note.
`depends_on: [10]` · `weight: light` · `live_model: no` · `coder: opus` · `verify_class: prose` · `kind: transcription`
- [ ] done

### Phase 12 — Acceptance drill A–F — HUMAN-GATED, `/run-plan` STOPS HERE
Not automatable: needs a real iPhone, airplane mode, two devices, a fresh browser profile, and a deliberately revoked token. C and F are already covered by Phase 2's unit tests; the rest are hands-on.
- **A.** Airplane-mode cold open on the installed iPhone PWA renders full state.
- **B.** Edit offline, reopen online → the events appear in `meridian-data`.
- **C.** Two devices edit different fields, then the same field, of one record → both converge, later write wins per field. *(unit-covered in Phase 2; confirm once for real)*
- **D.** Fresh browser profile + PAT → full restore matching live state. **Mandatory restore drill.**
- **E.** Revoke the PAT → red backup state within one flush cycle, app still fully usable, no spinner.
- **F.** Hand-corrupt a journal line in the repo → warning shown, everything else folds. *(unit-covered in Phase 2; confirm once for real)*
`depends_on: [11]` · `weight: heavy` · `live_model: no` · `coder: n/a` · `verify_class: prose` · `kind: HUMAN-GATED`
- [ ] done

### After the run
1. **Rotate the Supabase secret key immediately after Phase 0 verifies** — it was exposed in a chat transcript (DECISION 5).
2. Once a week of verified real use has passed, pause or delete the Supabase project deliberately.
Neither is a phase — both are calendar items for the owner.

---

## WAVE PLAN (derived from `depends_on` + disjoint `touches`)
```
W1  0                 human gate: credentials + repo creation
W2  1
W3  2 · 3 · 4         concurrent, disjoint files
W4  5 · 6             concurrent, disjoint files
W5  7
W6  8 · 9             concurrent, disjoint files
W7  10
W8  11
W9  12                human gate: STOP
```
