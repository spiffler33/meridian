# PLAN — Reading pane (`Read` view)

Meridian gains a fifth view: the reading surface for the newsletters library. Email continues unchanged as the broadcast edition; this pane is the owner's terminal. Same committed artifacts, two renderers.

## How to execute this plan

- **One phase per run. Stop at every gate.** Do not read ahead into the next phase's build list. The owner reviews on device between phases and may amend this file before the next run.
- Work lands on `local-first`. **Never push `main` mid-phase** — `main` deploys the live site.
- Each phase ends with: tests green (`vitest`), `grep -rn "localStorage" src/` still `0`, and the gate checklist satisfied.
- If anything in this plan contradicts `CLAUDE.md`, stop and ask. `CLAUDE.md` wins on the journal, sync, and token rules.

## Context

| thing | value |
|---|---|
| Source repo | `spiffler33/newsletters`, **private, read-only to this app, forever** |
| Library index | `state/gists.md` — one line per entry, ~326 lines |
| Surfaces (committed) | `state/tape.json` · `state/charts/<date>--<slug>/chart.json` (16) · `state/canon/lessons/<doc-id>/day-NN.json` + `syllabus.json` · `wiki/essays/*.md` + `.citations.json` sidecars |
| Source prose | `raw/<date>--<slug>/<slug>.md`, optional `figures.md` twin. `*_images/` is gitignored — **there are no images; render from numbers.** |
| Not in git (v1 non-goal) | morning-brief / refresh-inbox / onepager (die in `.queue/`) · `state/digest.*` (dead) |
| Auth | second fine-grained PAT, Contents:**read-only**, scoped to `newsletters` only |

## Hard fences (all phases)

1. **The app never writes to `newsletters`.** No branch, no commit, no PUT. Read-only PAT is the enforcement, not the only guard.
2. **Transport is trees + blobs, never the contents API.** The contents API dies at 1 MB (`encoding: "none"` — see CLAUDE.md limitation 2); `git/blobs/<sha>` works to 100 MB. One transport, no special cases.
3. The newsletters PAT lives **only** in the IndexedDB `meta` store (`newslettersToken`), same rules as `claudeApiKey`: never in source, bundle, log, URL, or error message. `newsletters.ts` takes it as a parameter and stores nothing.
4. Reuse the `GitHubError` taxonomy — branch on `kind`, never on `status`. On `ratelimit`, never tell the owner to revoke the PAT.
5. No compaction concerns here (we never write), but the same humility: **bad input never throws.** A malformed chart.json or citation renders a visible fallback, not a white screen.
6. No `localStorage`. No regex-over-natural-language heuristics in shipped logic. Splitting machine-defined filenames and heading-anchor normalization (Appendix C) are machine formats, not natural language — allowed.
7. Design: setpoint tokens (Appendix A). Mono for instruments; the reading face for prose. No emojis, no mascots — the wave is an instrument (it displays backlog state), or it doesn't ship.

---

## Phase 1 — Shell & theme (no network)

**Goal:** the `Read` view exists, themed, keyboard-reachable, rendering fixture data that mirrors `reading-pane-mockup.html`. Zero risk: no tokens, no fetches, no DB change.

Build:
- `src/views/ReadView.tsx` + route. Keyboard `R` joins T/W/Y in `useKeyboardShortcuts`. Sub-tabs: Tape · Chart · Canon · Essays · Library. Routes are **stable from day one**: `#/read/tape/<id>`, `#/read/chart/<date>--<slug>`, `#/read/canon/<doc>/<day>`, `#/read/essay/<slug>`, `#/read/raw/<slug>`. Tab and item selection live in the URL (existing principle: URL-based state).
- Setpoint tokens into the theme layer (Appendix A) as the canonical dark theme; light theme maps per Appendix A. Wire through existing `ThemeContext` — do not fork a pane-local theme.
- Typography split: prose class (Georgia serif stack, 16px, 1.68, max measure ~70ch) for reading bodies; mono everywhere instrumental. Amend `docs/DESIGN_PRINCIPLES.md`: *"Monospace for instruments; a reading face for long-form prose surfaces."* One sentence, deliberate, committed.
- `src/components/SetpointWave.tsx`: SVG wave + baseline + amber dot. Props: `unread: number`. Amplitude `scaleY` maps unread→[0.05..1]; state word ladder At setpoint / Holding steady (≤2) / Drifting. 0.8s ease, `prefers-reduced-motion` respected. Rendered in the Read header only (BackupStatus remains the meridian-data instrument — do not merge them).
- Fixture module `src/views/readFixtures.ts` feeding all five tabs.

Tests: route mounting, keyboard `R`, wave amplitude mapping (pure function), reduced-motion class.

**GATE 1 — owner reviews on phone + laptop:** theme, type split, wave feel, tab ergonomics. STOP.

---

## Phase 2 — Transport & cache (data goes live in Library)

**Goal:** real repo data, offline-capable, with the cheapest possible freshness check.

Build:
- `src/lib/newsletters.ts` (mirrors `github.ts` discipline):
  - `verifyReadAccess(token)` — `GET /repos/spiffler33/newsletters` → 200 readable, 401/403/404 not. (The forty-zeros PUT trick is for *write* verification; a read grant is proven by a read.)
  - `getHeadSha(token)` — `GET /repos/.../branches/main` → `commit.sha`.
  - `getTree(token, sha)` — `GET /git/trees/{sha}?recursive=1` → `[{path, sha, size}]`. Assert `truncated === false`; if ever true, surface a visible error (do not silently partial-sync).
  - `getBlob(token, sha)` — `GET /git/blobs/{sha}`, base64 → bytes → `TextDecoder('utf-8')`. **Never `atob` straight to string** — it mangles multibyte UTF-8, and the corpus is prose.
  - 30 s abort, jittered retry ×3 on 5xx, `GitHubError` kinds throughout.
- **IndexedDB `meridian` v1 → v2.** `onupgradeneeded` adds `contentCache` `{path → {text, sha, fetchedAt}}` and **touches nothing else**. Migration test proves v1 stores + data survive the bump. New `meta` keys: `newslettersToken`, `nlHeadSha`, `nlTreeFetchedAt`.
- Sync-on-open (and on `focus`), independent of the meridian-data queue (different repo, different token — no shared lock):
  1. `getHeadSha`; equal to cached → **done, zero further calls.**
  2. Else `getTree`, diff shas against `contentCache`, fetch changed **state-tier** files now (gists, tape, charts, canon, syllabus, essays + sidecars — tens of KB); `raw/` is **lazy, on open only**.
- Settings: "Newsletters (read-only)" block beside the existing token UI — paste, verify, clear. Same red/green visibility rules as backup status: silent failure is a bug.
- Library tab goes real: parse `state/gists.md` → rows (date, slug, gist line). Freshness dot = tree mtime for now (read-state is Phase 5).

Tests: sha-diff selector (pure), blob UTF-8 decode (multibyte fixture), migration v1→v2, verify matrix, tree-truncated error path.

**GATE 2:** owner pastes PAT on both devices; Library lists ~326 entries; airplane-mode cold open serves cache; Settings shows sync state honestly. STOP.

---

## Phase 3 — Surfaces render

**Goal:** everything already committed becomes readable. Citations render as chips but are **inert** this phase.

Build:
- **Tape** — `state/tape.json` → cards (headline, kicker, note, srcline). Window header. Unknown/missing fields render as absent, never `undefined` text.
- **Chart** — `chart.json` → card: headline, kicker, metric; `bars[]` as DOM/SVG bars, **value outside the bar** (house rule survives the medium); note + srcline. 16 existing files must all render — malformed one shows an inline error card naming the path.
- **Canon** — `syllabus.json` → doc nav; `day-NN.json` renders **from `text` + `citations[]`, never the stored email `html`**. Day ticker `day N/of`, prev/next.
- **Essays** — markdown via **one small renderer, HTML passthrough disabled** (his own content, but escape anyway). Pre-process `[^n]` markers into `<sup>` before render — no footnote plugin. Footnote strip from `.citations.json`.
- **Raw reader** — `#/read/raw/<slug>`: lazy blob fetch → render, cache. If the entry dir contains `figures.md` (known from the tree), a Prose | Figures toggle. Headings get stable ids at render time (Appendix C normalization) — Phase 4 lands on them.
- Loading = subtle inline state, no spinners where avoidable; failures = inline text naming what failed.

Tests: one fixture per surface incl. a deliberately malformed chart.json; `[^n]` pre-processor; figures toggle presence; raw lazy-fetch path.

**GATE 3:** owner reads a real tape, all 16 charts, a canon day, an essay, and a raw entry on the phone. Typography verdict. STOP.

---

## Phase 4 — Citations go live (the point of the pane)

**Goal:** every claim in every surface is a tap away from its source prose.

Build:
- `src/lib/citations.ts` — one resolver, three grammars in, one target out: `{slug, heading?} → #/read/raw/<slug>[@<heading-id>]` (Appendix C).
- Chip → navigate → raw reader scrolls to the heading, heading briefly hair-highlighted. **Heading not found → open at top + one hairline notice** ("§ not found — opened at top"). A citation is never a dead tap and never a hard error.
- Essays: footnote sup → popover (target slug § heading + one-line gist if present) → tap-through. Canon: inline `[§"…"]` chips + citations footer. Chart: `entries[]` as chips under srcline.
- Cross-surface: srclines that name a slug become live everywhere.

Tests: grammar fixtures for all three formats; normalization table (Appendix C) round-trips against real heading strings; not-found fallback; popover tap-through.

**GATE 4:** owner taps citations from all four surfaces into real raw prose on the phone. This is the feature — judge it harshly. STOP.

---

## Phase 5 — Read-state & homeostasis (the only journal change)

**Goal:** reading becomes cockpit data. The riskiest change lands last, on a stable pane.

Build:
- **Entity #10: `readItem`** (Appendix D). Add to `ENTITY`; write through the existing outbox/flush path — **never hand-assign folded state; go through `fold`** (CLAUDE.md rule stands).
- **Baseline (one event, not 326):** first successful pane sync upserts `profile.readingBaselineAt = now` **iff unset**. Unread ⇔ item date > baseline ∧ no `readItem`. A fresh device folds the same answer; day one shows a readable handful, not 326 alarms.
- Explicit mark-read affordances (checkmark in Library rows; "mark read" at the foot of each surface item). **No auto-read on open/scroll** — deliberate acts only. Un-marking deletes the `readItem` (tombstone; resurrectable — the fold already knows how).
- Wave goes live: `unread` from folded state; per-tab unread ticks in the tab rail (mono, small).
- Year view: reading joins the heatmap signal (a day with ≥1 `readItem` counts — smallest honest integration; do not redesign the heatmap).
- Compatibility note in code: an older deployed build folding a `readItem` event skips-with-warnings by design; single owner updates both devices. Verify the skip path in a test, don't assume it.

Tests: fold with `readItem` (upsert, delete, resurrect, natural-key adoption); baseline-idempotent (second device must not reset it); unread selector; heatmap contribution; old-`ENTITY` skip simulation.

**GATE 5:** two-device check — mark read on phone, watch laptop settle after sync. Journal in `meridian-data` shows clean `readItem` lines, one baseline event total. STOP. Plan complete; ideas.json / search / AI / `.queue/` surfaces are explicitly out of scope and get their own plans.

---

## Appendix A — Tokens (from setpoint-v5, canonical)

| token | dark | light (maps from the email spec) |
|---|---|---|
| `--bg` | `#07090d` | `#faf9f7` |
| `--panel` | `#0d1117` | `#ffffff` |
| `--panel2` | `#11161f` | `#f2f0ec` |
| `--ink` | `#e9eef5` | `#1a1f27` |
| `--muted` | `#7b8696` | `#6b7280` |
| `--faint` | `#46505f` | `#9aa1ac` |
| `--hair` | `#1a212b` | `#e5e2dc` |
| `--amber` | `#f0b04a` | `#b8860f` |
| `--green` | `#6ad29a` | `#1f8a5b` |
| `--ice` | `#6fa8d6` | `#2f6fa3` |

Type: prose `Georgia, 'Times New Roman', serif` 16px/1.68; instruments `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace`, tabular-nums. Light-theme accents are darkened for contrast on paper-white — verify ≥4.5:1 before shipping.

## Appendix B — API shapes

```
GET /repos/spiffler33/newsletters                    → 200 = readable
GET /repos/spiffler33/newsletters/branches/main      → commit.sha
GET /repos/spiffler33/newsletters/git/trees/{sha}?recursive=1
GET /repos/spiffler33/newsletters/git/blobs/{sha}    → {content: base64, encoding}
Headers: Authorization: Bearer <token> · Accept: application/vnd.github+json
```
base64 → `Uint8Array` → `TextDecoder('utf-8')`. Expected volume: one branch call per open; tree only on head change; blobs only for changed/opened files. Rate limit (5,000/hr) is unreachable at this scale.

## Appendix C — Citation grammars → one resolver

| source | grammar | resolves via |
|---|---|---|
| canon `day-NN.json` | inline `[§"Heading"]` | `citations[]` lookup by heading → `{slug, heading}` |
| essays | `[^n]` in md | `.citations.json` sidecar: `n → {slug, heading}` |
| chart.json | `entries[]` | each entry → `{slug, heading?}` |
| srclines | `raw/<date>--<slug> §"Heading"` | direct parse (machine-defined format) |

Heading-id normalization (applied identically to raw `#`-headings at render and to citation targets): trim → collapse whitespace → strip trailing punctuation → casefold → spaces to `-`. Match on normalized equality; anything fuzzier is banned (fence 6). Miss ⇒ top-of-file + notice.

## Appendix D — `readItem` entity

| field | value |
|---|---|
| entity | `readItem` |
| entityId (natural key) | `<surface>:<itemKey>` — `tape:2026-w34` · `chart:<date>--<slug>` · `canon:<doc>/<day>` · `essay:<slug>` · `raw:<slug>` |
| fields | `readAt` (ISO) · `starred?` (bool) · `note?` (string) |

Natural-key pattern follows habitCompletion; `resolveEntityId` applies unchanged. Delete = unread again; a later upsert resurrects with only post-delete fields — already the fold's contract.
