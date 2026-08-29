# PLAN — Pulse: the capture primitive (stream, coder, ledger)

Meridian gains its capture primitive: one text box whose entries become journal data that
everything downstream feeds on. The design separates **capture** (verbatim, instant,
offline) from **classification** (AI, async, judgment) — the same separation the US
national time-use survey uses: free-form diary first, trained coders after, because
natural-language activity needs judgment, not string matching. Here the coder is a model.

Doctrine, recorded: **AI as coder, not commentator.** Always-on, invisible classification
of the owner's utterances. Authored-AI prose returns only where there is content to
synthesize (ask-the-library, its own future plan). The day-shape briefing is dead
(see PLAN_CALENDAR amendment).

## Status — Phases 0–3 built and deployed; Phases 4 & 5 added and gated, 2026-08-29

Phases 0, 1, 2 and 3 are on `main` and live at meridian.spiffler.xyz. What is left of them
is the owner's: **Gate 0** (does Read feel cleaner without Week as a view?), **Gate 2** (a
week of coded living, then judge 20 pulses like an ATUS supervisor), and **Gate 3** (two
weeks of ledger). Gate 2 was not run before Phase 3 was built — recorded, with the reason,
in that phase's run-log entry. Each gate's verdict is an amendment to this file, not a new
plan.

**Phases 4 and 5 were added 2026-08-29 by the owner**, integrated from the addendum
`calendar/PLAN_PULSE_PHASES_4_5.md`, together with **hard fence 9**. Phase 4 retires the
coder's actuator effects; Phase 5 adds the nutrition ledger. **Neither phase begins until
Gate 3 has passed**, by the addendum's own terms. Nothing in `src/` implements either yet:
where the appendices below carry a Phase 4 or Phase 5 shape they say so inline, and the
shipped code still matches the pre-amendment shape.

## How to execute this plan

- **One phase per run. Stop at every gate.** Owner reviews on device between phases and
  may amend this file before the next run.
- ~~Work lands on `local-first`. Never push `main` mid-phase.~~ **Superseded 2026-08-29 by
  the owner:** work is committed and pushed to `main` directly, and `local-first` is
  fast-forwarded to match. Pushing `main` is what deploys, and IndexedDB is per-origin —
  the PATs and the Claude key exist only on `meridian.spiffler.xyz`, so a gate cannot be
  run from a branch or from localhost at all.
- Each phase ends: `vitest` green, `grep -rn "localStorage" src/` → 0, gate checklist met.
- Conflicts with `CLAUDE.md` ⇒ stop and ask. `CLAUDE.md` wins on journal, sync, tokens.

## Context

| thing | value |
|---|---|
| Repos touched | `meridian` only. `meridian-data` gains two entities via normal journal writes. |
| New entities | `pulse` (#11), `pulseVocab` (#12) — Appendix A. Nothing else. |
| Volume | dozens of pulses/day ≈ a few MB/year of journal — normal compaction rules apply, no special casing. |
| Coder model | `claude-sonnet-5`, as the named constant `CODER_MODEL` in `coder.ts` — one line to flip at Gate 2. Existing `claude.ts` plumbing (key from `meta`, direct-browser header, error taxonomy). |
| Depends on | calendar mirror (done) for event context and claims; existing habits & Tower for links. |

## Hard fences (all phases)

1. **Verbatim text is sacred.** The captured `text` is never rewritten, trimmed of meaning,
   or "cleaned". Enrichment upserts **must not include the `text` field** — field-level
   LWW then makes clobbering impossible by construction.
2. **Classification is AI-only.** No regex, no keyword lists, no string-pattern heuristics
   over pulse text anywhere in shipped logic — including "temporary" ones. If the coder is
   unavailable (offline, no key, API error), pulses remain **uncoded — a valid, visible
   state**, not a license for hacks. Machine-defined formats (ISO dates, ids) are exempt
   as ever.
3. **Capture never blocks.** Enter → outbox → rendered. No network, no parse, no
   confirmation stands between the owner and a saved line. Coding is async and lazy.
4. **Effects are proposals.** Every side-effect (habit tick, task spawn/update, event
   claim, vocab addition) renders as a dismissible chip. Nothing auto-applies until the
   owner enables that effect type in Settings (all default confirm-first).
5. **The coder's context allowlist is law** (Appendix B). The prompt sees only the listed
   slices. Never tokens, never reading content, never journal history beyond the listed
   items. A test proves the assembled payload is a subset of the allowlist.
6. **No sentiment.** No valence field, no affect scoring, no interpretive analysis,
   nowhere. Outputs are counts, hours, shares, timestamps — arithmetic on classified
   spans. A mood line is stored as `signal: state` and displayed. That is all.
7. Two new entities exactly (#11, #12). Older deployed builds skip-with-warnings on
   unknown entities; verify the skip path in tests.
8. Design: setpoint tokens. Timestamps and instruments mono; pulse text in the reading
   face at small size. Chips are quiet (hairline, muted). No streaks, no confetti, no
   gamification — the stream is a ledger, not a game.
9. **Habits and Tower are manual, intentional spaces.** No AI reads them, writes them,
   proposes about them, or receives them as context. Habit creation/edit/tick and Tower
   item creation/edit happen through their own UIs only, forever. The coder observes
   and classifies the owner's utterances; it is not an actuator.
   *Added 2026-08-29 with the Phases 4 & 5 addendum; Phase 4 is what carries it out, so
   the shipped build does not satisfy it yet.*

---

## Phase 0 — Reading v1.1 + IA restructure (display layer only)

**STATUS: built and deployed 2026-08-27. Gate 0 is unrun — it is spiff's, on the phone.**
Two departures from the letter of this phase, both flagged for the gate: the Brief tab was
kept on the rail (this phase names only the Library as leaving, and nothing here says where
briefs would go instead), and Habits kept its tab and its `h` — only Week left the rail.
Brief's list folds like the others.

**Goal:** the Read view gets calmer; the app's shape matches how the owner actually lives
(Today and Year are the poles; Week is a lens). Header space is cleared for Phase 1's box.

Build:
- **Read lists default to unread-only.** Read items collapse behind a muted `· n read`
  reveal at the foot of each list (Tape editions, Charts, Canon days, Essays, Library
  rows). Toggle is ephemeral (in-memory), not persisted.
- **Library leaves the tab rail.** Rail becomes Tape · Chart · Canon · Essays. Routes
  stay alive: citations still resolve into `#/read/raw/<slug>`, and `#/read/library`
  remains reachable via a quiet footer link in the Read view.
- **Week leaves top-level nav.** WeekView's content moves into a collapsible "This week"
  section at the top of YearView, **default collapsed** to a one-line summary row.
  Keyboard: `T`/`R`/`Y` are the primaries; `W` opens Year with the week section expanded;
  `P` is reserved (Phase 1). Remove Week from any rail/nav.
- **Wordmark → Settings.** The top-left brand mark becomes the Settings entry; remove
  Settings from any rail if present. The freed header region stays empty this phase.
- No schema, no transport, no journal changes.

Tests: unread filter + reveal toggle, library route reachability (citation → raw, footer
→ library), `W` behavior, wordmark → Settings navigation.

**GATE 0:** owner clicks around on the phone: does Read feel cleaner? Does Year-with-week
lens feel right, or is Week missed? STOP.

---

## Phase 1 — `pulse` entity, capture box, Today stream (raw only, zero AI)

**STATUS: built and deployed 2026-08-27. GATE 1 RUN 2026-08-28 on the first morning of real use;
the build list below is amended in place to match its verdict — pulse is its own view, the box is
at the foot, the stream reads chronologically.**

**Goal:** interstitial journaling ships. Timestamped verbatim lines, instant, offline.
Already valuable with no intelligence in the loop — that is the point of the layering.

Build:
- **Entity #11 `pulse`** (Appendix A). Capture writes `{text}` only; envelope `ts` is the
  timestamp; id comes from the house generator `newId()` (a stream, not keyed state).
  Derived fields are
  *documented now, written only in Phase 2*. Delete = tombstone via the normal path
  (long-press / kebab on a stream line). No edit in v1 — delete and retype keeps
  verbatim semantics trivial.
- **Pulse is its own view**, fifth on the rail: tower · pulse · habits · year · read.
  *Amended 2026-08-28 at Gate 1 — it was "the top of TodayView"; see the run log.*
- **Capture box** at the FOOT of that page. One field, no pickers, no buttons.
  Placeholder: `what's happening…`. Enter → outbox → optimistic render → field clears.
  Empty Enter is a no-op. Arriving on the page focuses the box — the tab is the gesture,
  so there is nothing to tap before typing. `Escape` blurs it, because every view key is
  dead while a field has focus. `P` is an ordinary view key now: it opens the page, and
  the focus follows from arriving.
- **The stream** fills the page above the box, **oldest-first**, scrolled to the bottom so
  the newest line sits directly above where the next one is typed. Line = mono `HH:MM` +
  text in the reading face ~14.5px. Today only — yesterday and earlier belong to
  Year/stats.
- **Tower keeps its own capture bar** and is otherwise untouched: a quick, glanceable page
  for what needs doing. The bar stops being `fixed`, which is what was slicing
  `what needs doing?` in half behind the sticky backup line.
- Pulses do not yet appear anywhere else (no heatmap, no stats).

Tests: pulse fold (create, tombstone, resurrect), day-filter + order selector, `P` focus,
optimistic render + outbox flush reuse, old-`ENTITY` skip simulation for `pulse`.

**GATE 1: RUN 2026-08-28.** Capture is frictionless; the stream was not where it belongs.
Answered: newest-first is wrong once the box moves to the foot. See the run log. A second
sitting on the amended shape is still worth having before Phase 2 starts.

---

## Phase 2 — The coder (classification, vocabulary, chips, Tower convergence)

**Goal:** the AI layer's daily-life form: invisible classification along five dimensions,
side-effects as proposals, one parser serving two mouths.

Build:
- **`src/services/coder.ts`** — `codePulse(text, context) → Coding` via one `CODER_MODEL` call
  (existing `claude.ts` request plumbing; strict-JSON system instruction; `max_tokens`
  ≤ 500; nulls over guesses). Contract in Appendix B.
- **Enrichment write:** upsert the pulse id with derived fields **only** (fence 1).
  Coding runs on-save when online; **uncoded pulses queue lazily** and get coded on next
  open. Stream shows the state honestly: hollow timestamp dot = uncoded, filled = coded.
  No spinners, no errors in the stream — uncoded is calm.
- **Entity #12 `pulseVocab`** (Appendix A): single natural key `vocab`. Seeded on first
  Phase 2 run iff unset (seed table in Appendix A — idempotent, one journal event).
  The coder reads it every call. `vocabProposal` in a coding renders an approval chip;
  approve = vocab upsert. The spine is code; the vocabulary is data.
- **Effect chips** (Appendix C): render under the pulse line; tap applies, dismiss drops
  the effect and keeps the coding. Types: `completeHabit` (ticks today's habit — no habit
  schema change; true timing lives in the pulse span), `spawnTask`, `updateTask`,
  `claimEvent` (sets `links.eventId`; claims are *derived* from the stream — no new
  entity, no toggle UI). Per-type auto-apply toggles in Settings, all default off.
- **Tower convergence — one parser, two mouths:** TowerView's input keeps its current
  behaviour exactly (immediate item from raw text — the owner likes it), but every
  submission is *also* recorded as a pulse, and the coder (task-biased context hint)
  later proposes field enrichments on the item (status / waitingOn / expectsBy) as chips
  on the item. The `parseTowerInput` stub is deleted; its seam is finally filled. The
  Pulse mouth (the plan's original "Today mouth" — the page moved at Gate 1) codes
  unbiased: `signal: task` there proposes `spawnTask`.
- Cost note in code comment: 30 pulses/day ≈ $6/month on Sonnet 5 (≈$2 on Haiku), at
  ~1.6K input + ~150 output tokens a call. No caching: the stable prefix sits under the
  ~1K-token cacheable minimum and pulses are scattered past the cache TTL anyway.

Tests: context-allowlist subset proof (fence 5), enrichment upsert excludes `text`
(fence 1), lazy uncoded→coded queue, each chip type apply/dismiss, vocab seed idempotence,
vocab proposal approval, Tower mouth immediate-item + later enrichment proposal, coder
unavailable ⇒ uncoded state (no fallback logic exists to test — assert absence).

**GATE 2:** a week of coded living. Judge the coder like an ATUS supervisor: pull 20 real
pulses, check domain/signal/span calls, check chips proposed. Miscoding rate decides
whether vocab needs editing or the prompt needs work — both are data/prompt fixes, never
heuristic patches. STOP.

---

## Phase 3 — The ledger (statistics; arithmetic only)

**Goal:** the energy questions answered with numbers. Everything here is arithmetic on
coded spans; uncoded pulses are excluded and their count is shown.

Build:
- **YearView gains an "Energy" section** (Year is the perspective view; no new top-level
  nav). Week-selectable, defaulting to current week.
- **Spent:** hours by domain, weekly bars (setpoint accents, values outside bars).
  Span closure rules in Appendix D (open block closes at the next `block`/`event` pulse
  or at the +4h cap, whichever first — cap is a named constant, tunable at the gate).
- **Needed vs Spent:** two adjacent charts sharing the week selector. Needed = calendar
  event hours by calendar, with `home` counting **zero unless claimed** (claims scanned
  from pulses with `links.eventId` on home-calendar events). Spent = the domain bars.
  Direct comparison is drawn only where the mapping is clean (`db ↔ db`); the rest sit
  side by side — no faked commensurability.
- **Habit timing:** for habits reachable via `habitAliases`, a time-of-day histogram of
  `span.start` (local hour) over the trailing 12 weeks. The gym question, answered.
- **Honesty line** on the section: `n uncoded pulses excluded` when n > 0.
- Nothing interpretive: no trends commentary, no targets, no comparisons to "ideal".

Tests: closure rules incl. cap and day-end, claim derivation, needed-vs-spent selectors,
histogram bucketing (tz-correct), uncoded exclusion + count.

**GATE 3:** two weeks of ledger. Does Spent match felt reality? Is the 4h cap producing
honest numbers? Does the Needed/Spent gap say anything the owner acts on? If the section
is wallpaper after a month, delete it without sentimentality — the stream and coder stand
on their own. ~~STOP. Plan complete.~~ **STOP.** *Amended 2026-08-29: the plan continues.
Phases 4 and 5 follow, and both are gated on this gate.*

---

## Phase 4 — Decommission actuator effects (the coder becomes a pure observer)

**GATED: does not begin until GATE 3 has passed.** Added 2026-08-29 by the owner.

**Goal:** habits and Tower return to fully manual ritual spaces. The coder keeps
classifying (including `signal: task` — the utterance is still worth recording); it
stops *doing*. This deletes the negative-habit bug class outright instead of fixing it:
no habit effect exists, so no habit chip can misfire.

Build:
- **Delete effects `completeHabit`, `spawnTask`, `updateTask`:** chip components, apply
  handlers, their Settings auto-apply toggles, their coder-prompt instructions, their
  output-schema entries, their tests. Surviving effects: `claimEvent`, `vocabProposal`.
- **Unknown effect types in coder output are discarded silently** (the model may still
  hallucinate a retired type; dropping is the whole handling — no error, no log noise).
- **`links` shrinks to `{eventId?}`.** `habitId`/`towerId` leave the type and docs.
  Historical journal events carrying them are untouched and simply ignored by the app
  (append-only log; no data migration).
- **`pulseVocab` drops `habitAliases`** from type and seed. The historical vocab event
  retains the field; the app ignores it. No migration, no explicit removal.
- **Tower reverts to fully manual:** input creates the item from raw text directly; no
  coder call, no pulse recorded from Tower submissions, no enrichment chips on items.
  Pulse box = journal; Tower box = commitments. Clean separation.
- **Coder context shrinks** (fence 5 + new fence 9): remove `todayHabits`,
  `openTowerItems`, and `mouth` from the allowlist and the assembly. One mouth remains.
- Amend Appendices B and C per the blocks below.

Tests: chips absent (assert non-existence), unknown-effect-type discard, Tower manual
path (item from raw text, no pulse written, no coder call), context payload contains no
habit/tower slices (allowlist subset test updated), vocab seed idempotence without
`habitAliases`, existing coded pulses with legacy `links` fields fold without warnings.

*Integration note, 2026-08-29 — an unresolved collision with shipped Phase 3, for the
owner, not for the builder to decide.* Dropping `habitAliases` also removes what the
**habit timing strip** reads: `ledger.ts` builds its 24-cell histogram from
`vocab.habitAliases` (`src/lib/ledger.ts:462`) to know which habits a pulse span belongs
to. That strip is arithmetic, not AI — fence 9 does not forbid it — but Phase 4 as written
deletes its only input. Three ways out, none chosen here: **(a)** keep `habitAliases` as a
read-only vocab field the ledger uses and the coder never receives, and drop only the
`habitAlias` *proposal kind* (proposing about habits is the part fence 9 forbids) —
recommended, smallest, keeps Phase 3 whole; **(b)** delete the timing strip with it, one
fewer thing; **(c)** move the mapping off `pulseVocab` entirely. Decide at Gate 3 or at the
top of Phase 4; whichever way, amend this bullet before building.

**GATE 4:** live with it several days. Two questions, both real: (a) do you miss "done
with the deck" closing the item from the box, or does walking to Tower feel right — is
the intentionality tax worth it in practice, not just in principle? (b) with only claim
and vocab chips left, is the stream calmer? STOP.

---

## Phase 5 — Nutrition ledger (calories + protein; arithmetic only)

**GATED: does not begin until GATE 3 has passed.** Added 2026-08-29 by the owner.

**Goal:** daily kcal and protein totals from ordinary food pulses. Stated numbers win,
estimates are marked, vague items are visibly uncounted. The ledger reads like something
an accountant would sign — and it never, ever comments on the eating.

Build:
- **`pulse` gains enrichment fields** (fields, not entities — fence 7 intact):
  - `nutrition?: {kcal: number|null, kcalSource: 'stated'|'estimated', proteinG?: number,
    proteinSource?: 'stated'|'estimated'}`
  - `coderRev: number` on every enrichment from now on. `CODER_REV = 2`; absent ⇒
    treated as `< 2`.
- **Coder prompt rules** (model-side extraction only — fence 2):
  - Populate `nutrition` whenever the text describes **the owner** consuming food or
    drink — regardless of domain/activity label. Beverages count; alcohol counts.
  - Other people's consumption never counts ("kids had pizza", "wife's dessert" ⇒ no
    `nutrition`).
  - Owner-stated kcal ⇒ `kcalSource: 'stated'` and the stated number verbatim — the
    coder never second-guesses the owner's figures. Same rule for stated protein.
  - No stated number ⇒ typical-portion point estimate, `'estimated'`.
  - Genuinely vague ("ate something at the buffet") ⇒ `nutrition` present with
    `kcal: null` — recognized consumption, uncounted. Nulls over guesses, as ever.
  - `nutrition` absent ⇒ not a consumption pulse. (`kcal: null` vs absent is the
    uncounted-vs-not-food distinction; Appendix B records it.)
- **Today instrument:** one small mono line between capture box and stream:
  `1,240 kcal · 830 est · 1 uncounted   ·   82 g protein` — protein is a single
  best-effort total (sources stored, not surfaced in v1). If `profile.kcalTarget` is
  set: append plain `· of 1,800`. **No colors by state, no words, no messages** —
  fence 6. Day boundary: **local midnight**, device tz.
- **`profile.kcalTarget`:** optional numeric field on the existing `profile` entity
  (precedent: `readingBaselineAt`), set via Settings, blank = off. Display treatment is
  provisional by owner decision — finalized at the gate.
- **YearView Energy:** seven daily kcal bars beside the existing charts — single bar
  per day, estimated share as a fainter segment of the same accent, total value outside
  the bar (house rule). Week's uncounted count as a mono footnote when > 0. Protein
  stays on Today in v1.
- **Backfill tool (Settings, owner-invoked, one-shot in spirit / idempotent in
  mechanism):**
  - Targets: pulses since `PULSE_EPOCH` (the Phase 1 ship date, a named constant) with
    `coderRev` absent or `< CODER_REV`.
  - Shows count and a rough cost line, requires confirmation, runs sequentially with
    progress and a stop button. Resume = rerun; the rev bound makes it idempotent.
  - Each re-code is one normal enrichment upsert — **fields only, never `text`**
    (fence 1). **All effects and vocabProposals from backfill output are discarded** —
    coding fields only; no chips about last Tuesday.
  - Per-pulse failure ⇒ that pulse keeps its old rev; the tool reports `n failed,
    run again`. Failure has one shape (uncoded/old-rev); no retry ladder.
  - **The ambient lazy sweep MUST NOT consider `coderRev`.** It still skips any pulse
    with `signal` present, permanently. Ambient re-coding is a billing bug by
    definition. A regression test pins this.
- Vocab seed amendment: `eating → self` added to `activities`. Nutrition extraction is
  **not** gated on this label — the label is for the ledger, the extraction is
  unconditional on consumption.
- No new services, no second model call — nutrition rides the existing single coder
  call. Amend Appendices A and B per the blocks below.

Tests: prompt-contract fixtures (stated kcal; stated kcal+protein; estimated; vague ⇒
`kcal: null` uncounted; other-people's food ⇒ absent; alcohol estimated), day-boundary
edges (23:59 / 00:01 local), Today totals selector (stated/estimated/uncounted split +
protein sum), target line on/off, weekly two-tone bars + value-outside, backfill rev
targeting, backfill effect suppression, backfill idempotent rerun, per-pulse failure
isolation, ambient-sweep-ignores-rev regression.

**GATE 5:** run the backfill first, then a calibration week. Spot-check ~15 food pulses
against your own knowledge of what you ate: are estimates in believable range, and is
uncounted rare enough that the total means something? Then the parked decision:
finalize the target display — keep the plain `· of` text, change it, or drop it. STOP.
Plan complete.

---

## Appendix A — Entities

**#11 `pulse`** — id: `newId()`, the same generator the other nine entities use
(`crypto.randomUUID`, with the non-secure-context fallback already in `entities.ts`).
Envelope `ts` = capture time.

*Amended 2026-08-27, was "ulid".* A ulid's sortability is redundant here: the fold orders by
`(ts, device, seq, id)` and `ts` is the capture time, so the envelope already puts a stream
in order. Id is the final tiebreak and nothing else. A ulid would mean a new dependency or a
hand-rolled one, for nothing.

| field | written | by |
|---|---|---|
| `text` | at capture, immutable | owner |
| `at` | at capture, immutable | owner — ISO instant. *Added 2026-08-27, see the run log.* |
| `signal` | enrichment | coder — `block · event · state · plan · task · claim · note` |
| `domain` | enrichment | coder — from vocab domains |
| `activity` | enrichment | coder — short label |
| `people[]` | enrichment | coder — aliases from vocab |
| `span` | enrichment | coder — `{start, end?, approx?}`; start defaults to `ts`, back-dated when stated ("this morning" ⇒ approx) |
| `links` | enrichment / chip apply | `{eventId?}`. *Amended 2026-08-29 (Phase 4), was `{habitId?, towerId?, eventId?}`; the two retired keys survive in historical journal events and are ignored.* |
| `nutrition` | enrichment | coder — `{kcal, kcalSource, proteinG?, proteinSource?}`; `kcal: null` = recognized consumption, uncounted; absent = not food. *Added 2026-08-29 (Phase 5).* |
| `coderRev` | enrichment | coder — schema revision of the coding; absent ⇒ pre-rev-2. *Added 2026-08-29 (Phase 5).* |

**#12 `pulseVocab`** — natural key `vocab`, one instance.

| field | shape |
|---|---|
| `domains[]` | seed: `db · hoa · family · home-ops · self · social · transit · admin` |
| `activities` | `{label → domain}` seed: `gym→self, read→self, deep-work→db, school-run→family, dinner→family, drinks→social, eating→self`. *`eating→self` added 2026-08-29 (Phase 5); nutrition extraction is **not** gated on this label.* |
| `people[]` | seed: `wife, kids` (grows via proposals) |
| ~~`habitAliases`~~ | *Removed 2026-08-29 (Phase 4), from type and seed. The historical vocab event keeps the field; the app ignores it. No migration, no explicit removal. Was: `{alias → habitId}` seeding `gym/lift/strength` → strength habit id, `read` → reading habit id.* |

Seeding: first Phase 2 run, iff unset — one journal event, idempotent across devices.

## Appendix B — Coder contract

**Context allowlist (fence 5) — the payload contains these slices and nothing else:**
`text` · `now` (ISO) · `tz` · `vocab` (full) · `todayEvents[{id,title,calendar,start,end}]`
· `recentPulses` (last 5: `{text, coding?}`).

*Amended 2026-08-29 (Phase 4): `todayHabits[{id,name,done}]`, `openTowerItems[{id,text,status}]`
and `mouth` (`today` | `tower`) are removed — fence 5 plus fence 9. One mouth remains. The
shipped build still sends all three; the allowlist subset test moves with the code.*
**The nutrition feature adds nothing to the context — the text already carries everything.**
Future sessions: do not "helpfully" enrich the context; this sentence exists so you don't.

**Output (strict JSON, nothing else):**
```json
{
  "signal": "block|event|state|plan|task|claim|note",
  "domain": null, "activity": null, "people": [],
  "span": {"start": "...", "end": null, "approx": false},
  "links": {"eventId": null},
  "nutrition": {"kcal": null, "kcalSource": "stated|estimated",
                "proteinG": null, "proteinSource": "stated|estimated"},
  "coderRev": 2,
  "effects": [{"type": "claimEvent", "...": "..."}],
  "vocabProposal": {"kind": "domain|activity|person", "value": "...", "mapsTo": null}
}
```
*Amended 2026-08-29. Phase 4 narrows `links` and the `effects` enum; Phase 5 adds
`nutrition` and `coderRev`. `vocabProposal` is a top-level key, not an effect type — the
addendum's "effects enum is `claimEvent | vocabProposal`" is Phase 4's surviving-effects
list, and is written here in the shape the code actually parses (`coder.ts`). Its
`habitAlias` kind goes with `habitAliases`, subject to the Phase 4 collision note above:
proposing about a habit is what fence 9 forbids, whichever way the field itself lands.*
Rules given to the model: nulls over guesses; `signal` always set (`note` when unsure);
never invent people, habits, events, or tasks not present in context; time expressions
resolved against `now` and `tz`; `mouth: tower` biases toward `task`.

## Appendix C — Effects & chips

| effect | applies | default |
|---|---|---|
| ~~`completeHabit`~~ | *Retired 2026-08-29 (Phase 4), fence 9. Was: ticks today's habit completion.* | — |
| ~~`spawnTask`~~ | *Retired 2026-08-29 (Phase 4), fence 9. Was: creates Tower item, sets `links.towerId`.* | — |
| ~~`updateTask`~~ | *Retired 2026-08-29 (Phase 4), fence 9. Was: proposes status/waitingOn/expectsBy on a matched open item.* | — |
| `claimEvent` | sets `links.eventId` — flips a home-calendar event to counts-as-mine | confirm |
| `vocabProposal` | upserts `pulseVocab` | confirm (never auto) |

Chips are dismissible; dismiss drops the effect, keeps the coding. Auto-apply is a
per-type Settings toggle, all off by default; `vocabProposal` has no auto option.

## Appendix D — Span closure

1. Stated duration ("next 2h") ⇒ `end = start + duration`.
2. Else open; closed by the next `block` or `event` pulse's start.
3. Else `end = min(start + 4h, 23:59 local)` with `approx: true`. `4h` is
   `OPEN_BLOCK_CAP`, a named constant — tune at Gate 3.
4. `state` / `note` / `plan` pulses never close a block and never carry duration into
   the ledger; `plan` spans (travel dates) are excluded from Spent.

---

## Run log

### 2026-08-27 — Phase 0: reading v1.1 + IA restructure

Green: `vitest` 510 passed / 26 files · `tsc -b` clean · `npm run build` clean ·
`grep -rn "localStorage" src/` → 0 · lint 6 errors, all pre-existing (unchanged count).

Deployed straight to `main` at spiff's instruction — the read PAT and the real mirrors exist
only on `meridian.spiffler.xyz`, so a localhost review proves nothing.

New: `src/utils/weekTotals.ts`, `src/components/Layout.test.tsx`.
Gone: `'week'` from `ViewType`; the Library and Settings tabs from their rails.

**The fold rule is `isSpent`, and it is deliberately not `!isUnread`.** Undated material — an
essay, a canon day — is never *unread*, because a reference must never alarm; but it is only
*spent* once the owner marks it. Reusing `isUnread` would have folded every essay and every
canon day on day one, and the lists would have opened empty and read as broken. Two extra
cases carry the same idea: a canon day that has **not arrived** never folds (it was not read,
it was not written), and the chart the rail is currently showing never folds out from under
the reader. Both are `keep` on the `Backlog` row.

**The reveal is a look, not a setting.** State lives in the `Backlog` component and dies with
it, per the plan. Nothing is persisted and nothing is journalled.

**The week became a lens without becoming a prop drill.** `weekOpen` is held in `App` rather
than in `YearView`, because `w` has to open it from anywhere; it is deliberately kept out of
the hash — it is a look at the year, not an address. `weekTotals` moved to `src/utils/` rather
than being exported from `WeekView.tsx`: exporting a function beside a component adds a
seventh `react-refresh/only-export-components` lint error, and the pre-existing count of six
is a documented verification baseline.

**Two departures from the letter of the phase, both for Gate 0 to rule on.** The phase says
"Library leaves the tab rail. Rail becomes Tape · Chart · Canon · Essays" — an end state with
no Brief in it, while the instruction names only the Library. **Brief was kept**: nothing in
the phase says where briefs would go instead, and removing a surface with no route-preservation
clause is the destructive reading. Its list folds like the others. Likewise **Habits kept its
tab and its `h`** — "T/R/Y are the primaries" reads as naming the poles, not as a removal
order, and only Week is listed as leaving.

**GATE 0 is unrun.** It is spiff's, on the phone: does Read feel cleaner, and does Year-with-a-
week-lens feel right, or is Week missed?

### 2026-08-27 — amendment: pulse ids

`ulid` → `newId()` (`entities.ts`), at spiff's instruction. The fold orders by
`(ts, device, seq, id)` and a pulse's `ts` is its capture time, so the envelope already puts
the stream in order; `id` is the final tiebreak and nothing else. Appendix A amended in place.

### 2026-08-27 — Phase 1: the pulse entity, the capture box, the Today stream

Green: `vitest` 522 passed / 28 files (was 510 / 26) · `tsc -b` clean · `npm run build` clean ·
`grep -rn "localStorage" src/` → 0 · lint 6 errors, all pre-existing (unchanged count).

New: `src/lib/pulse.ts`, `src/hooks/usePulses.ts`, `src/lib/pulse.test.ts`,
`src/views/TowerView.test.tsx`. Journal gains criterion 19 — the single-device-deploy guarantee,
restated for `pulse` rather than inherited from `readItem`'s example.

**The envelope `ts` could not be the timestamp, so `at` is a field.** The phase says capture
writes `{text}` only and that the envelope's `ts` is the pulse's instant. It cannot be: `fold`
returns `entity → entityId → field → value` and throws the envelope away, so a stream reading its
own `ts` would have no clock to render and Phase 3 no instant for a span to start at. The
alternatives were changing `FoldedState` to carry envelope metadata — the event contract, for
every entity, to serve one — or writing the instant as a field, which is what all ten existing
entities already do (`created_at`, `read_at`). So capture writes two fields, `text` and `at`, both
once and never again. The envelope still orders the fold. Appendix A amended in place.

**The `tower` h1 is gone; the capture box holds that header region.** "Pinned at the top of
TodayView in the cleared header region" had nowhere else to mean: Phase 0 never touched
TowerView, and the rail already says `tower` and marks it as where you are, so the h1 was saying
it twice. The box is now the first thing on the view and the stream sits directly under it, the
two grouped tighter than the day's other sections. Taps to a writable surface on open: zero.

**Two capture boxes live on Tower this phase, and that is the plan's own shape.** The pulse box
at the top, the tower bar still fixed at the bottom with its own placeholder. Phase 2 is what
converges them — one parser, two mouths — and the phase explicitly keeps the tower input's
behaviour exactly. Worth a look at the gate anyway: two boxes on one screen is the kind of thing
that reads fine in a plan and badly in a hand.

**Delete is a kebab, not a long-press.** The phase offers either. A hover-revealed control — the
idiom the Someday list uses — is simply invisible on the device this app mostly runs on, and a
long-press fights text selection. So: a quiet `···` per line, which reveals `delete` beside it.
Two taps, two separate hit targets, nothing that changes meaning under the finger.

**Colour comes from the app's tokens, not the `sp-*` set.** Fence 8 says setpoint tokens, and the
mono clock, the reading face and the hairline are all per the fence. The palette is not: Tower is
not the reading surface, `[data-surface="read"]` is what remaps the app's tokens to setpoint
values, and reaching for `sp-*` directly on Tower would drag the pane's palette onto the app's
chrome and leave a seam. Nothing is hardcoded — every colour is a token, which is what the fence
is protecting.

**A hazard Phase 2 inherits, recorded now.** An enrichment upsert that lands *after* a delete
resurrects the pulse carrying only what was written after the tombstone — so `text` falls back to
`''` and the stream shows an empty line. Nothing can produce it today: there is no edit path and
capture rejects an empty line. Phase 2's coder writes upserts against pulse ids from a queue that
can drain late, which is exactly the race. Pinned in `pulse.test.ts` as behaviour, not yet as a
guard.

**Deployed to `main` on spiff's word, same day as the build** — the phone is the only place the
gate can run, and Meridian's PATs are per-origin, so localhost proves nothing.

**GATE 1 is unrun**, and needs the phone: three real days of use. Its own questions are capture
friction and newest-first. One more for it, unasked by the phase: the stream has no cap, so a
heavy day pushes Now and the day shape a long way down a view whose job is to surface what needs
attention. The `· n more` fold from Phase 0 is the house answer if it bites.

### 2026-08-28 — Gate 1, and the restructure it ordered

Gate 1 ran on the first morning of real use rather than after three days, because one chatty
hour was enough to answer it. Capture itself passed: the box was reached and used without
thinking about it, and seven pulses landed before 08:00. The placement failed. In spiff's own
words, captured as pulses: *"on chatty days this fills up"*, *"we need a totally new tab for
pulse and text box at bottom"*, and — of the box sitting above everything — *"interesting UX
choice .. ok let's see"*. A morning's stream had already pushed Day Shape, Now and the whole
Tower below the fold, on a view whose entire job is surfacing what needs attention.

**Pulse is its own view.** Fifth on the rail, between tower and habits. Tower goes back to being
Tower — a quick, glanceable page for what needs doing — and Phase 1's build list above is
amended in place rather than annotated, because the old placement is not a thing anyone should
implement again.

**The box is at the foot and the stream reads downward.** That is the answer to the gate's own
question. Newest-first existed to keep the last utterance next to the box; once the box moves to
the bottom of the page, chronological is what does that, and the reverse would put the newest
line as far from the cursor as the page allows. `pulsesForDay` returns oldest-first and
`compareNewestFirst` is gone rather than kept as a second order nothing calls.

**Arriving focuses the box.** No `focusCapture` prop, no pending flag, no counter — the page
focuses its own input on mount, which is both simpler and what the gate asked for ("as soon as I
click on pulse, the cursor is switched on"). `P` therefore stopped being a special key and became
an ordinary view key. The cost is real and is paid deliberately: while the box has focus every
other view key is dead, so `Escape` blurs it.

**The footer grew a dock, which is the fix for the cut-off placeholder too.** Tower's
`what needs doing?` bar was `fixed bottom-0`, which put it underneath the sticky backup-status
footer and sliced the placeholder in half — visible in the gate screenshot. A `fixed` bar cannot
know how tall that footer is, and hard-coding an offset would be a magic number that breaks the
first time the backup line wraps. So the sticky footer now holds two rows: a slot the current
view portals its capture bar into, and the backup line beneath it. Both bars are docked there and
overlap stops being possible by construction. `Dock` distinguishes three states, and the third is
what stops a flash: no Layout above it at all (a view rendered alone, as tests do) renders the
bar in place, a Layout whose node is not attached yet on the first pass renders nothing, and
otherwise it portals.

**Untouched on purpose:** the entity, the fold, the journal, `usePulses`, and every fence. This
was a placement problem, and nothing below the view layer moved.

Green: `vitest` 524 passed / 28 files · `tsc -b` clean · `npm run build` clean ·
`grep -rn "localStorage" src/` → 0 · lint 6 errors, all pre-existing (unchanged count).
New: `src/views/PulseView.tsx`, `src/components/Dock.tsx`, `src/hooks/useDock.ts`,
`src/views/PulseView.test.tsx`. Gone: `src/views/TowerView.test.tsx` (its coverage moved with the
box), `compareNewestFirst`, the `onCapture` shortcut option, and TowerView's `focusCapture` props.

**The dock is pinned by position, not by class.** `Layout.test.tsx` renders a bar through `Dock`
and asserts it lands inside the `<footer>`, outside `<main>`, and before the backup line — the
three things that make overlap impossible. A class-name assertion would pass a revert to
`fixed bottom-0`; this fails it. Checked by mutation: with `Dock` degraded to render in place, the
test fails on the footer assertion, and passes again restored.

### 2026-08-28 — amendment: the coder runs on Sonnet 5, not Haiku

Priced before deciding, at the owner's outer max of 30 pulses/day and ~1.6K input +
~150 output tokens a call: Haiku 4.5 ≈ $2/month, Sonnet 5 ≈ $6/month. A 3× multiple on a
number this small is not the deciding term.

What decided it is the failure mode. A miscoding is **silent** — it renders as a normal
line, and Phase 3's Spent bars are arithmetic over exactly those calls, so a wrong domain
becomes a wrong hour with nothing marking it. The expensive resource here is Gate 2: a
week of the owner's life spent judging 20 real pulses. $4/month against re-running that
week is not a trade worth thinking about twice.

The part of Appendix B that wants the stronger model is not the strict JSON — small models
emit that fine. It is the restraint: *nulls over guesses*, *never invent people, habits,
events, or tasks not present in context*. Filling a field it should have left null is the
characteristic small-model error, and it is precisely the error that survives review.

So the model is `claude-sonnet-5`, held in `CODER_MODEL` in `coder.ts` — one line, flipped
at Gate 2 in either direction if the miscoding rate says so. Per doctrine, a weak coder is
answered by editing vocab, fixing the prompt, or sizing up. Never by a heuristic patch.

### 2026-08-29 — amendment: `now` is the pulse's own instant; the pulse row stores its proposals

Two readings settled while fixing what an adversarial review of Stage A found. Both stay
inside the fences; neither is a fence amendment.

**`now` means the pulse's moment, not the sweep's.** Appendix B's allowlist is law and has
no field for a pulse's `at` — but it has `now`, and nothing in the plan says `now` is the
wall clock at send time. The queue exists to code a pulse hours or days late, so the first
implementation, which sent `new Date()` plus today's events and habits, resolved "gym at 6"
captured Thursday against Saturday: silently wrong, and never revisited, because a coded
pulse is invisible to the sweep forever (P1). For someone classifying a diary entry, "now"
is the entry's moment. So `now` is the pulse's `at`, and `todayEvents`/`todayHabits` are
the pulse's own local day; `tz` stays the device's. The allowlist is unchanged — this
resolves a contradiction inside it. Recorded as an interpretation on `CoderContext.now`
so Gate 2 can see it and overrule it.

That also gives Appendix A's "`span.start` defaults to `ts`" something to default *to* at
parse time. It was defaulting to `''`, which round-trips into a journal that may never be
compacted and which Phase 3 would read as `Invalid Date`. With the default correct, a
one-field answer (`{"signal": "note"}`) is a *valid minimal* coding — "nulls over guesses"
means an all-null answer is legitimate, so there is deliberately no minimum-field gate.

**`effects` and `vocabProposal` are stored on the pulse row.** Appendix A's field table
listed six enrichment fields and the first implementation parsed the other two, paid for
them, and dropped them. Because the sweep never revisits a coded pulse, every pulse coded
before the chip UI ships would then have no proposals at all, unregenerably — and Appendix
C's "dismiss drops the effect, keeps the coding" needs them to outlive a reload. So the
pulse row carries eight enrichment fields, not six. This extends Appendix A's table; fence
7 caps *entities* at two, not fields, so it is inside the fence. `recentPulses[].coding`
still shows the coder only the six that describe the utterance — proposals awaiting a tap
are not context for classifying the next line, and fence 5's subset proof is unchanged.

Also from that review, without plan consequences: the sweep is capped at
`MAX_PULSES_PER_SWEEP` (20) per open and ends when the page that started it unmounts; a
capture codes its own line rather than re-walking the history; the coder call is aborted at
30 s and a `stop_reason: 'max_tokens'` response is a failure like any other; `habitAliases`
is repaired from empty when matching habits appear later, so an owner whose habits are
named differently does not lose Phase 3's histogram permanently.

### 2026-08-29 — amendment: Appendix B's effect payload, written out

Appendix B's output schema left an effect's payload as a placeholder —
`{"type": "completeHabit|spawnTask|updateTask|claimEvent", "...": "..."}` — and the first
implementation transcribed it verbatim, so the model was never told what an effect
actually carries. The chip code reads exact keys and validates only `type`, so a coding
answering `habit_id` or `waiting_for` would render a fallback label, write nothing when
tapped, and drop the proposal: a silently dead feature, and one that would have burned a
week-long Gate 2 before anyone noticed. `updateTask` was the worst of it — `text`,
`waitingOn` and `expectsBy` appeared nowhere in the prompt at all.

Filled in, in `coder.ts`'s `EFFECT_PAYLOADS`, which the system prompt now names:

| effect | keys |
|---|---|
| `completeHabit` | `habitId` — an id from `todayHabits` |
| `spawnTask` | `text`, optional; left out, the pulse is used verbatim |
| `updateTask` | `towerId` (an id from `openTowerItems`) plus at least one of `status` (`active\|waiting\|someday\|done`), `waitingOn`, `expectsBy` (`YYYY-MM-DD`) |
| `claimEvent` | `eventId` — an id from `todayEvents` |

A prompt fix, which is the doctrine: a coder that answers badly is met with vocabulary,
prompt, or a bigger model. The alternative — teaching the chip code to recognise a variant
spelling — is a string rule over the model's output, the same fence as a string rule over
the owner's text, and it would hide exactly the miscoding Gate 2 exists to see.

Also fixed in the same pass, without plan consequences: a coding that finished while the
backlog sweep was blocked on an earlier pulse was coded a second time (the sweep walks a
snapshot; the row is now re-read inside the coder's own in-flight guard) — with
`spawnTask` auto-apply on that put two Tower items on screen for one line; an enrichment
now merges `links` instead of replacing it, so a chip apply's recorded fact outranks a
later proposal; applies and dismisses of a pulse's chips are serialized and carry the
effect by value rather than by position, so two taps in one second cannot overwrite each
other's write; an applied chip now tells `AppContext` to re-read, so a spawned task is in
Tower before the next reload rather than after it; and `updateTask` to `done` writes
`done_at`, as completing an item from Tower always did.

### 2026-08-29 — Phase 2: the coder, closed. Gate 2 is open and is the owner's.

Green: `vitest` **635 passed / 32 files** (was 524 / 28) · `tsc -b` clean · `npm run build` clean ·
`grep -rn "localStorage" src/` → 0 · `grep -rn "parseTowerInput" src/` → 0 · lint 6 errors —
but see the suppression note below, because 6 no longer means what it meant. The suite was run
**80 consecutive times** at the end, not once: this phase produced two separate intermittent
failures, and a single green run proved nothing about either.

Shipped in three stages on `local-first`, **not deployed** — `main` is untouched, so
meridian.spiffler.xyz still serves Phase 1.

- **The coder.** `src/services/coder.ts`, one `claude-sonnet-5` call per pulse against Appendix
  B's allowlist, `max_tokens` 500, thinking disabled. Every failure — no key, dead network,
  non-2xx, unparseable JSON, a `signal` outside the seven — collapses to the same outcome: the
  pulse stays uncoded. There is no taxonomy, no retry ladder and no fallback classifier, and the
  absence is asserted by a test rather than merely intended.
- **Entity #12 `pulseVocab`**, natural key `vocab`, seeded once and idempotently, repaired if
  `habitAliases` seeds empty because no habit label matched. Criterion 20 pins that an older build
  folds it away quietly.
- **Chips.** Four effect types plus the vocab proposal, each a dismissible proposal; per-type
  auto-apply toggles in Settings, all off, and none of them retroactive — turning one on changes
  what happens next, never what is already stored. `vocabProposal` has no auto path at all.
- **Tower convergence.** One submission writes the item and the pulse in **one** commit; the box
  behaves exactly as before. `parseTowerInput` is deleted, and `toTowerItemInput` and
  `ParsedTowerItem` went with it — `src/services/ai.ts` is now 94 lines of date arithmetic with no
  AI in it.

**What the reviews caught that a green suite did not.** Each was proved by reverting the fix and
watching a test fail, not by reasoning:
- The lazy queue sent the coder **wall-clock `now`**, so a pulse captured Thursday and coded
  Saturday resolved "gym at 6" against Saturday — silently, and never revisited, because a coded
  pulse is never re-coded. Fixed by reading `now` as the pulse's own instant.
- `span.start` defaulted to `''`, which is not a null but junk that Phase 3 would have read as
  `Invalid Date`, in a journal that is never compacted.
- The same pulse could be **coded twice** — the sweep walks a snapshot and the in-flight guard only
  excluded overlap, never a completed prior coding. With `spawnTask` auto-apply on, two pulses
  produced three Tower items.
- A chip apply wrote the journal but never told `AppContext`, so a spawned task was **invisible
  until reload** and read as a failed write.
- A proposal landing on a `waiting` or `someday` item could be **neither applied nor dismissed** —
  the coder sees those items, but only active ones rendered chips, and the pulse leaves the stream
  the next day. Stranded forever.
- Chips carried their identity by **array position**, so a second tap could apply a proposal the
  owner never tapped.
- Six places called `scheduleFlush()` inside a durable write's own `try`, so a failure *after* a
  successful write reported failure — worst in `useReadState.toggle`, where it flipped a correct
  read-mark back to wrong.

**Deliberately not fixed.**
- The enrichment-after-delete resurrection stays **pinned, not guarded**. It is now routine rather
  than theoretical, and its blast radius changed: the resurrected row can carry an epoch `at`, so
  it renders *invisibly* rather than as an empty line.
- Two devices can still each code the same pulse; the fold merges it correctly, so the cost is one
  wasted call and a duplicate event. The real fix is architectural.
- `lint = 6` now includes **one suppression** — a `react-hooks/purity` error on
  `<DayShape now={Date.now()} />` that a `try` inside a hook callback used to mask. Its real fix is
  DayShape owning its own clock, which is the minute-ticker the owner declined: **blocked on a
  decision, not deferred.** `reportUnusedDisableDirectives` is now `error` so it cannot go stale
  unnoticed.
- Two pre-existing flakes, unrelated to this phase, appear only under concurrent load:
  `sync.test.ts > the sync triggers` and `ReadView.test.tsx > the instrument`.

**Add to GATE 2's checklist**, beyond the plan's own "judge 20 pulses like an ATUS supervisor":
1. **Do chips do anything?** Appendix B wrote an effect's payload as `{"...": "..."}` — a
   placeholder, never a specification — so the model was never told the key names the chip code
   reads. That is now written out (see the amendment above), but it is unproven against the real
   model. A chip that renders with a fallback noun and then quietly clears on tap is the symptom.
2. **Count `spawnTask` proposals from the Pulse mouth.** The tower-mouth clause is a strong
   prohibition sent on every call; a drop to zero from the *other* mouth means it over-reached.
3. **Is `now`-as-the-pulse's-instant right?** It is an interpretation of the allowlist, not an
   amendment to it. Backlogged pulses are where it shows.

### 2026-08-29 — Phase 3: the ledger, closed. Gate 3 is open and is the owner's.

Green: `vitest` **686 passed / 34 files** (was 635 / 32) · `tsc -b` clean · `npm run build` clean ·
`grep -rn "localStorage" src/` → 0 · lint **6, unchanged** — the same five pre-existing errors plus
the same one `DayShape` suppression Phase 2 left; nothing here added or silenced one.

Built **on `main`, and deployed.** The owner asked for it directly, overruling the plan's "work
lands on `local-first`" line, and `local-first` was fast-forwarded to match so the two cannot
drift. Worth recording that Phase 2's handoff was wrong about this: it said `main` was untouched
and the live site still served Phase 1, but `main` and `local-first` were already the same commit
(`ab7cb91`) — Phase 2 had shipped. Gate 2 was therefore reviewable all along.

**Gate 2 has not been run.** Phase 3 is arithmetic over exactly the codings Gate 2 exists to
judge, so every number this section draws inherits whatever the coder's miscoding rate turns out
to be. Built anyway, on the owner's instruction and for a stated reason: an unfinished phase left
open costs more a week later than an unmeasured one does. Gate 2's three checklist items are
unchanged and still owed.

- **`src/lib/ledger.ts`** — the whole of the arithmetic, pure, no IndexedDB and no React, in the
  way `journal.ts` and `pulse.ts` are pure. Clock and zone are arguments, so a test pins a week
  without pinning the machine. `src/components/EnergySection.tsx` computes nothing but a bar's
  width.
- **`YearView` gains an Energy section**, mounted directly under the week lens and reading the
  *same* week: its stepper calls `onPreviousWeek`/`onNextWeek`, the props the lens already had. A
  second week state on one page would let one screen show two weeks and call both "this week".
- **Spent** by domain, **Needed** by calendar, side by side; **needed vs spent** drawn only for the
  names that pair; a 24-cell heat strip per aliased habit over the trailing 12 weeks; the honesty
  line above all of it.

**Three readings the plan left open, taken here and written down so Gate 3 can overrule them.**
Each is one named constant or one function, not a scattering.

1. **`SPENT_SIGNALS = ['block', 'event']`.** Appendix D names the *closing* set outright and rules
   `state`/`note`/`plan` out of carrying duration, but leaves `task` and `claim` unstated in both
   places. Neither is time spent: a `task` is a thing not yet done, and a `claim` exists to move a
   calendar event onto the **Needed** side, where counting it again as Spent bills the same hour
   twice. One line in `ledger.ts` to change.
2. **An all-day event is counted, not billed.** Appendix A says Needed is "calendar event hours by
   calendar"; an all-day event has no clock. Billing it at 24 h buries every real meeting under a
   birthday, and any smaller number is invented. It shows as a count beside the bar — which is what
   `AllDayChip` already does elsewhere, for the same reason: the absence of a time is the signal.
3. **A stated duration is believed, uncapped and unclipped.** Appendix D's rule 1 is written
   unconditionally, so "next 2h" is two hours even where the next block starts inside them. That
   means two stated spans can overlap and bill one hour twice. Capping the owner's own words felt
   like this file overruling them; it is pinned by a test either way, so flipping it at Gate 3 is
   one edit.

**What building it caught.**
- `weekWindow` was Monday-only until it took `weekStartsOn`. The lens above it reads the setting;
  the two would have counted different days and both called it "this week".
- The section reads with `readPulseVocabRow()`, deliberately **not** `ensurePulseVocabSeeded()` —
  the latter seeds, and a statistics view that writes to the journal just by being opened is a
  write nobody asked for. It is safe only after `getPulses()` has awaited hydration, which is why
  they are in the same loader.
- `closeSpans` takes **every** pulse, never the week's. Rule 2 closes a block at the next one, which
  can be on the far side of the week edge; clipping first makes Monday's first block hit the cap
  every time. Clipping happens after both ends are known.
- Two blocks on one millisecond leave the earlier zero-length. It is dropped — but *which* one is
  decided by the id, the fold's own final tiebreak, so two devices drop the same one. Array order
  would have made the answer depend on fetch order. Pinned by running the same pair both ways.
- A local day is not 24 hours. The day-end cap goes through the zone's own midnight, so a block
  started on a spring-forward Sunday does not collect a free hour of Monday.

**Deliberately not built.** No trend line, no target, no week-over-week comparison, no commentary
(fence 6) — the section states quantities and stops. Nothing writes: Energy is read-only, and the
chips remain the only surface that applies anything.

**GATE 3, and it is the owner's.** Two weeks of ledger. Does Spent match felt reality? Is
`OPEN_BLOCK_CAP_MS` (4 h) producing honest numbers, or is a Saturday morning's single pulse
claiming half the day? Does the Needed/Spent gap say anything worth acting on — and is the
`db ↔ db` pairing the only clean one, or should `home ↔ family` be drawn too? Watch the three
readings above; each is a one-line change. If the section is wallpaper after a month, delete it
without sentimentality: the stream and the coder stand on their own.

### 2026-08-29 — addendum integrated: Phases 4 & 5, and hard fence 9

A documentation run, no `src/` change. `calendar/PLAN_PULSE_PHASES_4_5.md` arrived after
Phase 3 closed, written outside the session that closed it, carrying two new phases and a
new fence. Its own paste-over instructions are now carried out here: **hard fence 9**
(habits and Tower are manual spaces; the coder observes and classifies, and is never an
actuator) joins the global list, **Phase 4** (decommission the `completeHabit`, `spawnTask`
and `updateTask` effects) and **Phase 5** (nutrition ledger — kcal and protein, arithmetic
only, with an owner-invoked backfill) sit after Phase 3, and Appendices A, B and C carry
the amendments. Both phases keep the addendum's own gate: **neither begins until Gate 3 has
passed.** Integrating the document is not building the phases.

Four readings taken where the addendum was silent or where the plan disagreed with itself.
Each is recorded rather than smoothed over:

- **Its header names `docs/PLAN_PULSE.md`; the plan lives at `calendar/PLAN_PULSE.md`.**
  There is exactly one Pulse plan in the repo and `docs/` holds none, so the target was
  unambiguous and no file moved. Flagged, not asked.
- **`habitAliases` is load-bearing for shipped Phase 3.** Phase 4 drops it from
  `pulseVocab`; `ledger.ts:462` reads it to build the habit timing strip. Left **unresolved
  on purpose** — an integration note under Phase 4 states the collision, lists three ways
  out with a recommendation, and hands the choice to the owner at Gate 3 or at the top of
  Phase 4. A builder is not to pick one silently.
- **"Effects enum is `claimEvent | vocabProposal`" is loose.** In `coder.ts` the output has
  `effects` and `vocabProposal` as separate keys; `vocabProposal` was never in the effects
  enum. Appendix B is written in the shape the parser actually reads — effects enum narrows
  to `claimEvent`, `vocabProposal` stays its own key — which is what Phase 4's
  surviving-effects line means.
- **The `habitAlias` vocab-proposal kind follows the field out.** The addendum removes
  `habitAliases` but never mentions the proposal kind that writes to it. Fence 9 forbids the
  AI proposing about habits regardless of where the mapping ends up, so the kind goes either
  way; noted against the collision above.

The appendices now describe the post-Phase-5 contract while the shipped build is still
pre-Phase-4. Rather than let the doc quietly lie about what runs today, every amended row
says which phase it belongs to, Phase 3's `Plan complete` is struck with a pointer forward,
and the `## Status` header at the top states plainly that nothing in `src/` implements
either phase yet.

**No gate of its own.** Gates 0, 2 and 3 remain open and unchanged, and Gate 3 is what
unlocks Phase 4.
