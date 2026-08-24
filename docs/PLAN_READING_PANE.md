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

## Phase 1 — Shell & theme (no network) — **DONE 2026-08-24** (`0ec0d39`)

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

## Phase 2 — Transport & cache (data goes live in Library) — **DONE 2026-08-24** (`4c792f7`)

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

## Phase 3 — Surfaces render — **DONE 2026-08-24** (`5f72fff`)

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

## Phase 4 — Citations go live (the point of the pane) — **DONE 2026-08-24**

**Goal:** every claim in every surface is a tap away from its source prose.

Build (as shipped — the original wording said "heading" throughout; see the Appendix C amendment):
- `src/lib/citations.ts` — one resolver, three grammars in, one target out: `{slug, file, phrase} → #/read/raw/<slug>[/<file>[/<span>]]` (Appendix C).
- Chip → navigate → raw reader scrolls to the **block carrying the span**, block briefly hair-lit. **Span not found → open at top + one hairline notice** ("§ not found — opened at top"). A citation is never a dead tap and never a hard error.
- Essays: footnote sup → popover (target slug § heading + one-line gist if present) → tap-through. Canon: inline `[§"…"]` chips + citations footer. Chart: `entries[]` as chips under srcline.
- Cross-surface: srclines that name a slug become live everywhere.

Tests: grammar fixtures for all three formats; normalization table (Appendix C) round-trips against real heading strings; not-found fallback; popover tap-through.

**GATE 4 — UNRUN as of 2026-08-24:** owner taps citations from all four surfaces into real raw prose on the phone. This is the feature — judge it harshly. STOP.

> Deferred by the owner: the review origin (`localhost` / a LAN IP) has its own IndexedDB, so it wants both PATs entered again. Review on the laptop's `localhost:5173` — the origin phases 2–3 were reviewed on, which likely still holds the newsletters token — or on the phone once at home. Phase 5 may proceed first; Gate 4 still has to be walked before the pane is called finished.

---

## Phase 5 — Read-state & homeostasis (the only journal change) — **BUILT 2026-08-24, GATE 5 UNRUN**

**Goal:** reading becomes cockpit data. The riskiest change lands last, on a stable pane.

Build:
- **Entity #10: `readItem`** (Appendix D). Add to `ENTITY`; write through the existing outbox/flush path — **never hand-assign folded state; go through `fold`** (CLAUDE.md rule stands).
- **Baseline (one event, not 326):** first successful pane sync upserts `profile.readingBaselineAt = now` **iff unset**. Unread ⇔ item date > baseline ∧ no `readItem`. A fresh device folds the same answer; day one shows a readable handful, not 326 alarms.
- Explicit mark-read affordances (checkmark in Library rows; "mark read" at the foot of each surface item). **No auto-read on open/scroll** — deliberate acts only. Un-marking deletes the `readItem` (tombstone; resurrectable — the fold already knows how).
- Wave goes live: `unread` from folded state; per-tab unread ticks in the tab rail (mono, small).
- Year view: reading joins the heatmap signal (a day with ≥1 `readItem` counts — smallest honest integration; do not redesign the heatmap).
- Compatibility note in code: an older deployed build folding a `readItem` event skips-with-warnings by design; single owner updates both devices. Verify the skip path in a test, don't assume it.
- **Error boundary — added to this phase 2026-08-24, the precondition for merging to `main`.** The app has none today: a render-time throw anywhere unmounts the whole tree, and `main` deploys the daily cockpit. One class component (`src/components/ViewBoundary.tsx` — boundaries must be classes; plain constructor, no parameter properties, `erasableSyntaxOnly` forbids them), wrapping `renderView()`'s result inside `<Layout>` in `App.tsx:83` so the shell and its nav survive a dead view.
  - **Keyed on `nav.view`**, so changing tab clears a caught error. Without the key the fallback latches and the app is stuck on it for the session.
  - Fallback is a `Failed`-shaped card: names the view that died, offers *reload* and stays inside the shell so another tab is one tap away. **Never renders the error's message or stack** — the secrets fence says nothing derived from a failure raised near a token may be shown. `import.meta.env.DEV` may `console.error` the real thing, matching `AppContext`'s boot catch.
  - Not a silent swallow: a dead view must say it is dead. Silent failure is a bug here as everywhere else.
  - Tests: a child that throws renders the fallback while the nav rail still renders; switching view clears it; the message text never reaches the DOM.

Tests: fold with `readItem` (upsert, delete, resurrect, natural-key adoption); baseline-idempotent (second device must not reset it); unread selector; heatmap contribution; old-`ENTITY` skip simulation; the boundary's three cases above.

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

> **AMENDED 2026-08-24, after reading the corpus.** The table below assumed `§"…"` names a heading.
> It does not. In `state/tape.json`, the essays' footnote definitions and the canon's inline marks,
> the § target is a **quoted phrase lifted from the source text** — `§"may have spent more than
> $95bn"`, `§"And finally I shorted Tesla (TSLA) at 416.22"`, and for a `figures.md` target even a
> table row: `§"1998 Long Term Cap Mgmnt Collapse | Feb 1998 | 330 | +2% | ..."`. Quote style also
> varies: straight quotes in tape/essays, curly `“ ”` in canon. So heading-id normalisation is not
> the mechanism — phase 4 has to locate a **text span** in the rendered document and scroll to it,
> with the same not-found fallback (open at top + one hairline notice). Everything else in the table
> holds: three grammars in, one resolver, one target out.

**SETTLED 2026-08-24 (phase 4).** Three grammars, named at the call site rather than sniffed from
the string — the caller always knows which one it holds, and a chart entry that reads like a phrase
must never be resolved as one. `src/lib/citations.ts`:

| grammar | who writes it | shape | resolves to |
|---|---|---|---|
| `path` | tape `evidence[].citation`, essay `[^n]` definitions | `raw/<slug>/<file>.md §"span"` | `{slug, file, phrase}` |
| `phrase` | canon inline `[§“span”]` and `citations[]` | a span, with the lesson's `entry` | `{slug, file, phrase}` |
| `slug` | chart `entries[]`, tape `evidence[].slug` | a bare slug, no span | `{slug, file, phrase: null}` |

`file` is `prose | figures` — the essays cite the figures twin directly. The closing quote is the
**last** one in the run, not the first: the corpus quotes prose and prose contains quotes.

**Matching is a text span, not a heading id.** `normalizeForMatch` = NFKC → fold curly quotes →
collapse whitespace → lowercase, applied identically to the citation and to the text of each rendered
block; first block that contains it wins. That is a character-level equivalence table, nothing
fuzzier (fence 6). Measured over the whole corpus: **924/924 citations resolve and land on a block**
in exactly what `RawPane` draws — 12 tape, 592 essay, 134 canon footer, 149 canon inline, 37 chart.
Zero unresolved, zero missing files, zero missing spans. Whitespace collapse alone left 56 misses;
the quote fold cleared 55 of them and the case fold the last one. No dash folding was needed.

Route: `#/read/raw/<slug>[/<file>[/<span>]]` — positional, the span carried in the address so a
citation survives a reload, a back button and being sent to yourself. Miss ⇒ top of file + one
hairline notice.

## Appendix D — `readItem` entity

| field | value |
|---|---|
| entity | `readItem` |
| entityId (natural key) | `<surface>:<itemKey>` — `tape:2026-w34` · `chart:<date>--<slug>` · `canon:<doc>/<day>` · `essay:<slug>` · `raw:<slug>` |
| fields | `readAt` (ISO) · `starred?` (bool) · `note?` (string) |

Natural-key pattern follows habitCompletion; `resolveEntityId` applies unchanged. Delete = unread again; a later upsert resurrects with only post-delete fields — already the fold's contract.

---

## RUN LOG

### 2026-08-24 — phases 1–3 shipped, on `local-first`

**Phase 1 — shell & theme** (`0ec0d39`). Fifth view at `R`, five tabs, the setpoint palette in the
theme layer (dark canonical on `:root`, the two light themes remap it, `[data-surface="read"]` makes
the whole screen adopt it while the pane is mounted), the prose/mono type split, and the wave. Routes
are the path-shaped hash `#/read/<surface>[/<item>…]`; `useNavigation` reads both grammars and stays
the only writer of either.

**Phase 2 — transport & cache** (`4c792f7`). `newsletters.ts` (trees + blobs, read-only, sharing
github.ts's request plumbing and error taxonomy), IndexedDB v1→v2 with `contentCache`, sync-on-open
and on focus, the Settings block, and the Library from real data. Measured on the corpus: 322 entries,
316 gists, 49 state-tier files, 714 KB.

**Phase 3 — surfaces render** (`5f72fff`). Tape, Chart, Canon, Essays and the source reader, plus
`markdown.ts` — a character-scanning parser producing a tree, never HTML. Parses the 1,066 KB AI Index
entry in 17 ms.

**Amendments the corpus forced** (the plan was written before these files were opened):
1. `state/tape.json` is a *themes tape* — a window, eight themes with state/delta, and six cards
   carrying two opposing stances, a pressure line and evidence items — not headline/kicker/note cards.
2. `chart.json`'s `bars[].w` is the **quantity**, not a percentage (307.65, 115, 24). The widest bar
   sets the scale per chart. Value stays outside the bar.
3. There are **no `.citations.json` sidecars** in `wiki/essays/`. Footnote definitions live at the
   foot of each essay's own markdown (`[^n]: raw/… §"…"`), which is where the strip is built from.
4. Raw entries have no title in any index; they carry one in their own frontmatter, so the reader
   shows it on open and the Library shows the slug.
5. Three `raw/` subdirectories (`chats`, `newsletters`, `notes`) are empty placeholders. An entry is a
   directory holding a markdown file named after it — that is the rule the library list uses.
6. `state/gists.md`'s prose header contains the ` | ` separator its entries use. The tree join (a line
   counts only if what precedes the separator is a slug the tree has) rejects it without any rule
   about what prose looks like.
7. Appendix C is wrong about `§` targets — see the amendment there.

**Deliberate departures from the plan, all owner-visible:**
- Light-theme `--sp-amber` and `--sp-green` darkened to ~5.1:1; the appendix's values measured 3.1:1
  and 4.1:1 against the 4.5:1 the appendix itself asks for. `--sp-faint` stays sub-threshold in both
  themes by design.
- `meta.nlTree` added (the plan lists three new meta keys, this is a fourth): without a cached tree
  the airplane-mode cold open has no entry list, because gists.md cannot say which entries exist.
- The Library's freshness dot stays the **local read toggle** rather than becoming tree-derived. Git
  trees have no mtime, and the honest version of that dot is phase 5's read-state; a second throwaway
  mechanism in between would be deleted a phase later.
- `SetpointWave` takes `unread: number | null`. A pane with no token has no backlog to report.
- `github.ts` now exports its request plumbing (`call`, `failure`, `readJson`, `fromBase64`) and its
  two failure reasons, shared with the newsletters transport so the rule that a rate limit never
  blames the token cannot drift between them.

**Still open at Gate 3:** the wave reads ~322 unread and pins at Drifting until phase 5's baseline
lands. Three book-sized entries (500 KB – 1 MB) may pause on open; not yet measured on the phone.

**The morning brief** (raised by the owner during phase 3, out of the original scope): it was written
only to `.queue/`, which is gitignored, so it never reached the repo this pane reads. The newsletters
skill now writes the panel-adjusted §7 outline to `state/briefs/<DATE>.md` and commits it with
`state/ideas.json` (newsletters commit `dbe0d39`, **local and unpushed**). The Meridian side is not
built: it needs `state/briefs/` in the sync tier and a sixth surface, and there is nothing to render
until a `/morning-brief` run lands one. This is its own small phase, not part of 4 or 5.

### 2026-08-24 — phase 4 shipped, on `local-first`

**Every citation on every surface is a tap.** One resolver in `src/lib/citations.ts`, three grammars
in, one target out; `RawPane` is where they all land. Appendix C is rewritten above with what the
corpus actually contains and with the measurement.

What each surface got:
- **Tape** — each evidence chip names the document and opens it at the quoted sentence.
- **Chart** — `entries[]` become chips. The card's `srcline` is left as text on purpose: it names
  publications ("FT (Lex) '26 · The Economist '26"), not slugs, so there is nothing in it to resolve.
- **Canon** — the inline `[§“…”]` marks and the footer both resolve through the lesson's own `entry`
  (`day-NN.json`, or the syllabus). A course whose files name neither leaves its marks drawn but
  inert rather than pointing them all at a guess.
- **Essays** — the `[^n]` marker opens a popover first (slug · the library's one-line gist · the
  span) and the source second, and the strip at the foot taps into the same place.

**Decisions worth knowing about:**
1. **The landing is the block, not the character span.** Highlighting the exact run would mean
   splitting text nodes at offsets mapped back through the normaliser — a span-splitting renderer in
   `Markdown.tsx` for a corpus whose paragraphs run a few sentences. The block is scrolled to centre
   and lit for 1.8s (`--sp-land`, a token rather than an opacity utility, following `--sp-rim`'s own
   stated reason); reduced motion keeps the tint and drops the travel.
2. **Chips elide, they do not wrap or overflow.** Inline in prose they take 24ch (52ch on `sm`); on
   their own line in a source strip they take the column. The full string is in the `title`, and the
   canon footer prints every citation in full, one per line.
3. **The file toggle is keyed to the route it was made on.** Opening the next citation starts from
   what that citation asked for, not from wherever the last one was left. No reset effect.
4. **A citation into a `figures.md` the entry does not have** opens the prose and says so — a second
   notice, distinct from the not-found one.

**Measured:** the worst case is the 1,071 KB AI Index entry — 4,644 blocks, 20 ms to parse, 31 ms to
scan every block for a span that is not there. No optimisation warranted.

Tests: 364 pass in 18 files (was 329 in 17). `citations.test.ts` runs the resolver against strings
copied verbatim out of the repo — a span with quotes inside it, a figures table row carrying pipes, a
curly-quoted canon mark, a bare chart slug. `useNavigation.test.ts` proves a span survives the hash
with its slashes, pipes, quotes and percent signs intact. `readSurfaces.test.tsx` taps through from
all four surfaces, checks the inert path when a lesson names no source, and covers both notices.
`npm run lint` is back to its 6 pre-existing errors; `grep -rn "localStorage" src/` is still 0.

**Still open at Gate 4:** the wave still reads ~322 unread and pins at Drifting until phase 5's
baseline lands — expected, not a bug.

### 2026-08-24 — amendment: the error boundary joins phase 5

Asked why phases 1–4 were not going to `main`, two answers held and one of them is fixable.

The app has **no error boundary at all** (`grep -rn "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError" src/` → nothing), so a render-time throw in any view unmounts the whole tree — and `main` deploys the daily cockpit. That is the one blocker worth removing rather than working around, so it is now part of phase 5's build list above, and the precondition for the merge.

The other reason stands and is not fixable by writing code: **the v1→v2 database migration is one-way.** Phase 2 added `contentCache` and bumped `DB_VERSION`. Deploying upgrades both devices; a rollback then has a v1 build opening a v2 database, which throws `VersionError`, which `AppContext`'s boot catch turns into `DEFAULT_HABITS` — the data is intact underneath but the app reads as wiped and every write fails until `main` is deployed forward again. So "just roll it back" is not available, and the merge should happen once, with phases 1–5 together, after gates 4 and 5.

### 2026-08-24 — phase 5 shipped, on `local-first`

**Reading is cockpit data.** `readItem` is entity #10, the baseline is one event, every surface can
be marked read, the wave reads the fold, and the app has an error boundary for the first time.

What landed:
- **`readItem`** — `src/lib/entities.ts`. The entity id IS the natural key (`<surface>:<itemKey>`),
  `read_at` is the only field, unmarking is a tombstone and re-marking resurrects.
- **The baseline** — `profile.reading_baseline_at`, written once by `ensureReadingBaseline()` in
  `src/services/data.ts`, on the pane's first sync.
- **Marking** — the Library row's checkmark, and a `MarkRead` at the foot of each surface item
  (tape · chart · canon day · essay · raw). No auto-read on open or scroll.
- **The instrument** — `unread` is folded state now; the tab rail carries per-tab ticks.
- **The Year heatmap** — a day with ≥1 `readItem` comes off the floor (`heat-1`) and says `· read`
  in its label. `getHeatLevel` is untouched.
- **`src/components/ViewBoundary.tsx`** — one class, keyed on `nav.view` inside `<Layout>`.

**Decisions worth knowing about:**
1. **The backlog is dated material only.** Entries, the tape window and the charts carry a date; the
   canon and the wiki do not. They are references rather than a queue — you do not fall behind on a
   wiki — so they can be marked (a course keeps progress) but they never alarm and carry no tick.
   Undated material is never unread, which is also what makes the rule total.
2. **The baseline day itself counts as unread.** An item's date has no time in it, so an entry
   published on the baseline's own day cannot be placed either side of the instant. Rounding it to
   "already read" would hide it forever; rounding it the other way costs one tap.
3. **The wave reports the entries, not the sum of all surfaces.** The tape and the charts are
   digests of the same entries — adding them would count one week's reading three times. Each tab's
   own backlog is on that tab.
4. **A second guard on the baseline, and it is the one that matters.** Writing only when unset is
   not enough: a second device that has not yet pulled the journal would see none, stamp a *newer*
   one, and last-writer-wins would silently mark every entry between the two as read. So a device
   with an empty journal cache does not get to decide — it will have one within a sync.
5. **`reading_baseline_at`, not `readingBaselineAt`.** The profile is a ported Postgres row and
   every other column is snake_case; one camelCase field would be the only one. Same for
   `readItem.read_at`.
6. **`resolveEntityId` is not applied to `readItem`.** The entity never existed in Postgres, so no
   row can carry a surrogate id — the key IS the id from the first write, and resolution over rows
   whose ids are already their keys is the identity. Applying it would be ceremony, not safety.
7. **Appendix D's `starred` and `note` are not written.** Nothing offers either yet; the journal
   takes a new field the day something does, with no migration.
8. **Marks schedule a flush.** `useReadState` calls `scheduleFlush()` after a write — a mark is an
   edit, and the 5 s debounce is the primary path to the journal. Without it a mark waited for a
   visibility or focus event.

**The compatibility claim was wrong, and the truth is better.** The plan said an older deployed build
folding a `readItem` event "skips-with-warnings by design". It does not: `fold` validates an event's
*shape* and never its entity name, so the record lands in a bucket that build has no reader for and
is simply never looked at — no warning, no loss, and the event is still there when that device
updates. That is what makes a new entity safe to deploy one device at a time. Pinned as
`journal.test.ts` criterion 18 and noted on `ENTITY`.

**One real bug found and fixed while testing**, in `useReadState`: each toggle re-reads the store to
pick up the day the mark landed on, and those reads can finish out of order — mark then unmark, and
the mark's read-back arrives last, putting the tick straight back. Only the newest toggle's read is
allowed to land now. It surfaced as a flaky test, which is exactly what it would have felt like on a
phone.

**A test-harness leak, also fixed.** `ReadView.test.tsx`'s teardown deleted the database while a
view's writes were still in flight; `deleteDatabase` is *blocked* by an open connection rather than
refused, and the old `onblocked` handler resolved anyway — so one test's marks leaked into the next.
It now waits the writes out and rejects loudly if the delete is ever blocked again.

Tests: 403 pass in 21 files (was 364 in 18). New: `readState.test.ts` (the backlog rule),
`ViewBoundary.test.tsx` (shell survives · error text never rendered · the key clears it),
`YearView.test.tsx` (reading lifts a day and labels it). Added to `entities.test.ts` (mark, converge,
tombstone, resurrect, reload; baseline written once, never reset, idempotent, never invented),
`journal.test.ts` (criterion 18), `readSurfaces.test.tsx` (the key each surface mints).
`npm run build` clean, `npx tsc -b` clean, `npm run lint` at its 6 pre-existing errors,
`grep -rn "localStorage" src/` still 0.

**GATE 5 is unrun.** Two devices, a mark on the phone, the laptop settling after sync, and one
baseline event in the journal — the owner's to run.
