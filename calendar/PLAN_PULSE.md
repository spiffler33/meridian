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

## Status — all six phases built and deployed, 2026-08-29

Phases 0, 1, 2 and 3 are on `main` and live at meridian.spiffler.xyz. What is left of them
is the owner's: **Gate 0** (does Read feel cleaner without Week as a view?), **Gate 2** (a
week of coded living, then judge 20 pulses like an ATUS supervisor), and **Gate 3** (two
weeks of ledger). Gate 2 was not run before Phase 3 was built — recorded, with the reason,
in that phase's run-log entry. Each gate's verdict is an amendment to this file, not a new
plan.

**Phases 4 and 5 were added 2026-08-29 by the owner**, integrated from the addendum
`calendar/PLAN_PULSE_PHASES_4_5.md` (archived), together with **hard fence 9**. Phase 4 retires the
coder's actuator effects; Phase 5 adds the nutrition ledger.

**Phase 4 is built and deployed, 2026-08-29**, along with the **activity histogram** that
replaced the habit timing strip it removed. The addendum gated Phase 4 behind Gate 3; the
owner lifted that gate the same day and ordered it built — *"i dont like this gating you
choose - this is my decision not yours"* — so it shipped with Gate 3 still open, and the
same call governs what follows. **Gate 4 is now open and is the owner's.**

**Phase 5 is built and deployed, 2026-08-29**, by the owner's instruction and with Gate 3
still unrun — the addendum gated it behind Gate 3, that gate is the owner's to lift, and
they lifted it. The nutrition ledger, the Today line, the weekly kcal bars and the
owner-invoked backfill are all on `main`. **Gate 5 is now open and is the owner's**: run
the backfill, then a calibration week.

**Coder rev 3 landed the same day**, hours after Phase 5, from a real failure on real data:
`corrections` (day totals the owner asserts) and the `span.start` bucketing fix. Confirmed
working on device. See the last run-log entry.

**The plan is complete and the owner is living with it.** Every phase is built; what
remains is five gates, all of them the owner's, each verdict an amendment to this file.
**Gate 5's calibration week began 2026-08-29** — no further building is queued, and the
next thing to happen to this plan is a verdict, not a phase.

**Gate 5's first verdict landed the same day** (last run-log entry): a correction is a
**waterline, not a lid**, and the Today line is now one number. Two of that gate's three
questions are answered — correcting a day by saying so works in the hand, and the parked
target display is settled. The estimate-quality question still needs the week, and the
backfill is still unrun. Gate 5 stays open.

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

**STATUS: built and deployed 2026-08-29.** Added by the owner the same day, from the
addendum, which gated it behind Gate 3 — a gate the owner then lifted by hand. Gate 3 is
still unrun. One departure from the letter of this phase, and it is not small: the habit
timing strip was **deleted**, not preserved. See the run log entry for why the three
options below collapsed to one — and the entry after it, where the owner ordered the
replacement built the same day: **an activity histogram**, which answers the same question
with no habit knowledge at all.

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

*Resolved 2026-08-29, at build time: **(b)**, the timing strip is deleted.* The collision
this note first recorded was deeper than `habitAliases`. The histogram counted
`links.habitId`, not the alias map — the aliases only chose which habits got a row. Phase 4
takes habits out of the coder's context, so the coder has no habit id to answer with, so
`links.habitId` is never written again. Option (a), keeping `habitAliases` as ledger-only
data, would have left a strip whose input had dried up: correct for a fortnight, then
silently decaying to zero as the trailing window rolled past the last pre-phase-4 pulse.
A statistic that quietly becomes wrong is worse than one that is gone. Deleting it also
makes this phase's own `habitAliases` removal clean, with no reader left behind — which is
most likely what the addendum meant by removing it at all.

**GATE 4:** live with it several days. Two questions, both real: (a) do you miss "done
with the deck" closing the item from the box, or does walking to Tower feel right — is
the intentionality tax worth it in practice, not just in principle? (b) with only claim
and vocab chips left, is the stream calmer? STOP.

---

## Phase 5 — Nutrition ledger (calories + protein; arithmetic only)

**STATUS: built and deployed 2026-08-29.** Added 2026-08-29 by the owner, who lifted its
Gate 3 gate the same day and ordered it built next — Gate 3 is still unrun, and Gate 5's
calibration week is what will judge this phase instead. See the run log for what shipped
and the two things it changed along the way.

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

**GATE 5 — OPEN, 2026-08-29.** Run the backfill first, then a calibration week. Spot-check ~15 food pulses
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
| `corrections` | enrichment | coder — `[{date, kcal, proteinG?}]`, day totals the owner asserted. Local `YYYY-MM-DD`, resolved against `now`/`tz`. **No source field — a correction is owner-stated by definition.** Coexists with `nutrition` on the same pulse; one pulse may correct several days. *Added 2026-08-29 (Phase 5, rev 3).* |
| `coderRev` | enrichment | coder — schema revision of the coding; absent ⇒ pre-rev-2. `CODER_REV = 3`. *Added 2026-08-29 (Phase 5); bumped to 3 the same day, see the run log.* |

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

*Amended 2026-08-29 (Phase 5, rev 3): `corrections` is added to the OUTPUT schema and the
**context allowlist is unchanged**. A correction is the owner stating a number, not the
model being asked to check one, so it needs no yesterday, no running totals and no ledger
read. A test asserts the payload's top-level keys are exactly the six above.*

**Output (strict JSON, nothing else):**
```json
{
  "signal": "block|event|state|plan|task|claim|note",
  "domain": null, "activity": null, "people": [],
  "span": {"start": "...", "end": null, "approx": false},
  "links": {"eventId": null},
  "nutrition": {"kcal": null, "kcalSource": "stated|estimated",
                "proteinG": null, "proteinSource": "stated|estimated"},
  "corrections": [{"date": "YYYY-MM-DD", "kcal": 0, "proteinG": null}],
  "coderRev": 3,
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

**`corrections` is deliberately NOT an effect and has no chip** *(decided 2026-08-29,
Phase 5 rev 3; recorded here so it is not revisited)*. An effect is a proposal to write
something ELSEWHERE — another entity, another day's record — and it needs a tap because
the owner has not yet agreed to it. A correction is neither: it is a fact the owner
uttered, stored on the pulse that uttered it, exactly as `nutrition` is. Asking them to
confirm a number they just typed is a confirmation dialog for their own sentence. Undo is
deleting the pulse — the selector then falls back to the item sum, or to the correction
before it. There is no separate uncorrect gesture and there should not be one.

**A correction is a waterline, not a lid** *(amended 2026-08-29 after a day of living with
it; see the last run-log entry)*. It states what the day came to as of the instant it was
said, so it subsumes everything eaten up to that instant and everything after it is added
on top. Read as a lid it silently swallowed the rest of the day. One rule serves a finished
day and a day still being lived, and the coder is never asked which one it is looking at.

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

A documentation run, no `src/` change. `calendar/PLAN_PULSE_PHASES_4_5.md` (archived) arrived after
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

### 2026-08-29 — Phase 4: the coder stops acting. Gate 4 is open and is the owner's.

Built and pushed to `main` the same day the phase was written, **with Gate 3 still unrun**.
The addendum gated Phases 4 and 5 behind it; the owner lifted that gate by hand — *"i dont
like this gating you choose - this is my decision not yours"* — which is recorded here
because Gate 4's answers now arrive before Gate 3's, and Energy changed underneath Gate 3
while it was open.

**What went.** `completeHabit`, `spawnTask` and `updateTask` are gone from the type, the
prompt, the output schema, the chip labels, the apply handlers, the Settings toggles, the
`meta` keys, and their tests. `links` is `{eventId?}`. `pulseVocab` has no `habitAliases`,
and `vocabProposal` has no `habitAlias` kind. `PulseMouth` is gone entirely — Tower's box
writes an item and nothing else, calls no coder, and shows no chip on any item, so
`captureTowerItem` and `useTowerPulses` were deleted rather than trimmed. The coder's
context is now `text · now · tz · vocab · todayEvents · recentPulses`, and nothing on that
path reads the habit store or the tower store at all.

**Surviving effects: `claimEvent` and `vocabProposal`.** Both still confirm-first, both
still by value through one serialized queue.

**A retired type is dropped, silently, in two places** — `entities.ts` when a journal line
is folded, `coder.ts` when a response is parsed. A pre-phase-4 journal line and a model
that hallucinates `spawnTask` are the same case and get the same non-treatment: no error,
no warning, no log. A retired proposal is not a malformed one.

**The habit timing strip is deleted, and that is a real subtraction from shipped Phase 3.**
The integration note left three options open for the owner. Building it collapsed them to
one: the histogram counted `links.habitId`, and phase 4 stops that field ever being written
again, because the coder no longer sees a habit id to answer with. Keeping `habitAliases`
would have preserved a chart whose data supply had been cut — right for about twelve weeks,
then decaying to zero as the trailing window rolled forward, with nothing on screen saying
so. `HISTOGRAM_WEEKS`, `trailingWindow`, `habitTiming`, `HabitTiming`, `ClosedSpan.habitId`
and `TimingRow` all went with it. **If Gate 4 wants the answer back**, the honest rebuild is
a histogram over `activity` — the coder still classifies that, it needs no habit knowledge
at all, and it answers the same question ("when do I actually go to the gym") without any
AI touching a habit. That is a phase, not a patch.

**One thing was made stricter, not looser.** `AppContext`'s `addTowerItem` now rethrows.
Tower's box hands the owner's text back when a write fails, and a swallowed error made that
fallback unreachable — the pre-phase-2 code had the same dead branch. It is the only
non-deletion in this phase.

**Coverage that left with the features, stated rather than absorbed.** `AppContext`'s "a
chip applied on the Pulse page reaches the reducer" pair is deleted: no surviving effect
writes outside the pulse row, so nothing calls `reportLocalWrite` from an apply any more,
and there is no honest way to keep the test. `TowerView.test.tsx` was rewritten around the
manual path and now asserts the coder's ABSENCE (`codePulse` mocked purely so a call can be
proved not to happen). Two absence tests were added on purpose: the prompt names none of
the retired effects and no habit or tower slice, and the coder context carries neither —
checked against a habit and a tower item that really exist in the fixture, so it cannot pass
by there being nothing to leak.

**Verified:** `vitest` 637 passed / 33 files, green three consecutive runs. `tsc -b` exit 0.
`npm run build` exit 0. `npm run lint` 6 errors — the same six as before this phase, all
pre-existing. `grep -rn "localStorage" src/` → 0.

**Noticed, not touched:** `getCompletionsForDate` (entities.ts) now has no caller outside
`entities.test.ts` — `buildCoderContext` was its last one. Left in place.

**GATE 4, and it is the owner's.** Live with it several days. (a) Do you miss "done with the
deck" closing the item from the box, or does walking to Tower feel right — is the
intentionality tax worth it in practice, not just in principle? (b) With only claim and
vocab chips left, is the stream calmer? ~~And inherited from the collision above: (c) does
Energy still say anything useful without the timing strip, or is the activity-histogram
rebuild worth a phase?~~ **(c) is answered: the owner ordered the rebuild the same day and
it shipped — see the entry below. What (c) now asks instead is whether the coder's activity
labels hold still enough, across twelve weeks, for the strip to mean anything.** STOP.

### 2026-08-29 — the timing strip, rebuilt on `activity`

Ordered by the owner immediately after Phase 4 closed, and built the same session. Not a
phase of its own: it restores a Phase 3 instrument that Phase 4 removed, on a different
input, and it changes no contract — no entity, no field, no prompt, no journal write.

**What it is.** `activityTiming(pulses, window, timeZone)` in `ledger.ts`, and an "activity
timing" strip in Energy where "habit timing" used to sit: one 24-cell heat row per activity,
the busiest first, over the trailing twelve weeks ending with the week the stepper is on.

**Why it works where the habit version could not.** The old strip counted `links.habitId`,
which the coder can no longer write — it never sees a habit. It still writes `activity`, a
short label, on every coded pulse. That needs no habit, no alias map, and no vocabulary read
at all, which also keeps Energy's promise not to seed anything by being opened. And it is
strictly wider: it answers "when does this happen" for everything the owner talks about
rather than only for the handful of things they had made a habit of and aliased.

**Four readings, each one line, each meant to be flipped at a gate.**
- **`SPENT_SIGNALS` decides what counts** — `block` and `event`, the same set the bars above
  are drawn from, so the two instruments cannot disagree about what a week contained. A
  `note` mentioning the gym is not the gym happening.
- **`span.start`, not `at`.** The moment the activity began, so a block the coder back-dated
  ("gym this morning", said at noon) lands in the morning.
- **A row appears only where something was logged.** The habit strip drew empty rows on
  purpose — a fixed roster the owner had configured, where "you have never logged this" was
  the answer. Activities are an open set the coder can add to; a row per vocabulary word
  would be a list of words, not an answer.
- **`TIMING_ROWS = 8`, and the remainder is COUNTED, not dropped** — "n quieter activities
  not shown". Twelve weeks of an ordinary life is more than eight labels, and twenty heat
  strips on a phone answer nothing; a cap that hides its own existence would be the section
  quietly lying about its scope.

**Also cleaned up:** `EnergySection.test.tsx` had kept mocks for `getHabits` and
`readPulseVocabRow` after Phase 4 stopped Energy calling either. Mocking what a component no
longer touches hides a regression rather than preventing one, so both are gone and the file
now mocks the stream alone.

**Verified:** `vitest` 649 passed / 33 files, green three consecutive runs (637 → 649: nine
arithmetic tests, three rendering ones, and `trailingWindow` restored). `tsc -b` exit 0,
`npm run build` exit 0, `npm run lint` at the same 6 pre-existing errors, `localStorage` 0.

**No gate of its own.** It reports to Gate 4's question (c), which is no longer "should this
be rebuilt" but "do the coder's activity labels hold still enough, across twelve weeks, for
the strip to mean anything" — a question only real coded weeks can answer.

### 2026-08-29 — Phase 5: the nutrition ledger, closed. Gate 5 is open and is the owner's.

Green: `vitest` 688 passed / 33 files (was 649 / 33), three consecutive clean runs ·
`tsc -b` clean · `npm run build` clean · `grep -rn "localStorage" src/` → 0 · lint 6
errors, all pre-existing and unchanged for four phases.

Built as specified. `pulse` gained two enrichment fields — `nutrition` and `coderRev`,
fields and not entities, so fence 7 is intact. The coder's prompt gained the nutrition
rules and nothing else; `NUTRITION_RULES` in `coder.ts` is the whole of the extraction,
and there is no food list, no portion table and no unit parser anywhere in `src/` (fence
2). Today shows a mono line between the stream and the box; Energy shows seven daily kcal
bars; Settings gained a calorie target and the backfill tool.

**The context allowlist did not grow, and there is now a test that says so** — it asserts
the assembled payload's top-level keys are exactly Appendix B's six. Appendix B's sentence
about not "helpfully" enriching the context was written for a future session; this makes
it fail a build rather than a review.

**Three interpretations, each recorded because each could have gone the other way.**

**1. `coderRev` is stamped locally, never read off the model's answer.** Appendix B's
schema shows `"coderRev": 2` and it is transcribed into the prompt verbatim, but
`toCoding` ignores whatever comes back and writes `CODER_REV`. The rev describes the
schema *this build parses against* — a fact about the code, not about the answer. A model
that echoed `1`, omitted the key, or wrote `"two"` would leave that pulse permanently in
the backfill's sights, re-coded and re-billed on every run. Pinned by a test.

**2. The backfill omits `effects` and `vocabProposal` from its event entirely, rather than
writing them empty.** The plan says a backfill produces "no chips about last Tuesday",
which is a rule about not CREATING proposals. Writing `[]` and `null` would have gone
further and destroyed a proposal already sitting there unanswered — a re-code that quietly
clears the owner's inbox. Field-level last-writer-wins leaves an unmentioned field exactly
as it was, so `enrichPulse` gained a `scope` argument (`'full' | 'codingOnly'`) and the
backfill path is the second. A test captures a pulse with a pending chip, backfills it, and
asserts the chip is still there and the backfill's own proposal is not.

**3. Uncoded pulses are in the backfill's scope.** The plan's target is "pulses since
`PULSE_EPOCH` with `coderRev` absent or `< CODER_REV`", and an uncoded pulse has no
`coderRev` either — the literal reading. It is also the right one: the ambient sweep does
at most twenty per open, so a long backlog would otherwise never be finished by anything.

**One bug found and fixed while testing the weekly chart.** A week in which every logged
meal was uncounted rendered "nothing eaten was logged this week" — the chart telling the
owner they had not eaten. "Nothing was logged" and "nothing that was logged could be
counted" are different weeks and only the first is empty; the empty state now also requires
`uncounted === 0`.

**The ambient sweep still knows nothing about `coderRev`**, and its own describe block says
so: three simulated opens plus the on-save path against a pulse coded at rev 1, asserting
the coder is never called, and that the pulse is still the backfill's business afterwards.
Ambient re-coding is a billing bug by definition — it would look completely correct on
screen, which is why it is pinned as a regression test rather than left to review.

Other decisions worth naming:

- **`kcal: null` versus an absent `nutrition` survives end to end** — parser, row reader,
  ledger and both surfaces. A figure that is not a finite non-negative number reads as
  uncounted rather than as zero: a silent zero drags a day's total down while still looking
  like a total.
- **`kcalSource` falls back to `estimated`, never to `stated`.** Dressing the coder's guess
  up as the owner's measurement is the single error that field exists to prevent.
- **The day boundary is `pulsesForDay`'s, imported rather than restated.** The line sits
  directly above the box and must add up exactly the lines visible above it, so it buckets
  by `at` and not by `span.start`, which can be back-dated.
- **`kcalLabel` pins `en-US`.** It is the only place in `ledger.ts` a number is rendered
  rather than compared, and an unpinned locale would print the same journal differently on
  the phone and the laptop.
- **`PulseView.test.tsx` now renders inside the real `AppProvider`**, as `TowerView`'s
  tests already did: the target is profile state, and a stubbed context would prove nothing
  about the wiring between a profile write and what the line prints. Its file comment said
  the view read no app state; that is no longer true and the comment was corrected.
- **The target's display is provisional, as the plan says.** It reads `620 kcal · of 1,800`
  — attached to the figure it qualifies, which is the only unambiguous placement, and one
  array entry to move or delete at the gate.
- **The vocabulary seed gained `eating → self`.** Seeding is once-ever and idempotent, so a
  device that seeded before this line existed never gains it, and nothing needs it to —
  extraction is not gated on the label.

**GATE 5 is open.** Run the backfill first (Settings → re-code history: `count`, then the
run button, which shows the price before it does anything). Then a calibration week:
spot-check ~15 food pulses against your own knowledge of what you ate — are the estimates
in believable range, and is uncounted rare enough that the total means something? Then the
parked decision: finalize the target display — keep the plain `· of`, change it, or drop it.

### 2026-08-29 — amendment: corrections, and the day food belongs to (coder rev 3)

Ordered by the owner within hours of Phase 5 shipping, from a real failure on real data.
They ran the backfill, read Friday as 1,220 and Saturday as 880, and typed into the box:
*"mate friday is 2400 cals; saturday your 880 est is fine"*. The 2,400 was added to **today**.

**Two bugs, stacked, and neither was the model's.**

**1. The coder had no way to say "correction".** Its entire nutrition vocabulary was "the
owner consumed N kcal", so faced with a sentence asserting a day's total it answered with
the closest thing the schema allowed. A stronger model would at best have declined to
answer — it still could not have fixed Friday, because there was no field for the answer.
Model choice was not the lever, and swapping to Opus would have bought nothing.

**2. `dayNutrition` bucketed by `at`, not `span.start`.** So even when the coder back-dates
a span — which it already does, and which `activityTiming` has always counted by — the
calories landed on the day the sentence was typed. The reasoning written into the code
("the line sits directly above the box and must add up exactly the lines visible above
it") was a UI-consistency argument, and it loses outright to "food must land on the day it
was eaten". It also made ordinary retro logging silently wrong: *"big dinner last night,
about 900"* went on today, permanently, and no correction could move it because the day
was not what was wrong. **Fixed: items bucket by `span.start`, falling back to `at`.** The
stream still reads by `at` — it shows what was SAID today, which is a different question.

**What shipped**

`pulse` gains a third enrichment field, `corrections: [{date, kcal, proteinG?}]` — an
array, because one sentence can settle several days, and because empty is the ordinary
answer. It coexists with `nutrition` on the same pulse: *"had a burrito, 620; friday was
2400"* is one line making two kinds of claim and both are kept. **No source field** — a
correction is owner-stated by definition, so a `stated | estimated` discriminant would
have exactly one reachable value.

Prompt: emit a correction when the owner asserts a specific day's total. **An override and
a ratification are the same act** — *"friday was 2400, not 1220"* and *"saturday's 880 is
fine"* both end with the owner having stated that day's total, and the second is not a
no-op just because the number agrees. That is what lets a ratified day stop being drawn as
an estimate. **An ambiguous day reference produces nothing**: a day guessed at here is
silent, wrong, and outranks the arithmetic it replaced.

Ledger selector, in order: the newest correction for day D wins; else the sum of items
bucketed by `span.start`. Newest is by capture order with the id tiebreak, so two devices
agree on which correction stands. On a corrected day `estimatedKcal` and `uncounted` both
go to zero — both describe how the sum underneath was arrived at, and there is no
estimated share of a figure the owner gave; an unsizeable meal is subsumed by it, which is
what stating a day's total means. **Protein is corrected only when the correction says
so**: *"friday was 2400"* is a claim about calories, and discarding the item protein sum
would silently zero a number the owner never disputed. Corrected days render single-tone,
value outside, no estimate marker.

**The date is validated by round trip, not by a pattern**, and that is load-bearing rather
than fence-compliance theatre: `Date.parse('2026-02-30T00:00:00Z')` returns **March 2**,
and `'+002026-08-28'` parses fine. Both were measured. A correction naming a day that does
not exist would sit in the journal applying to no day at all — present, invisible, and
outranking real arithmetic. `parseCorrections` is exported from `entities.ts` and used by
both the journal reader and the coder's parser: two copies would be two places to get that
check wrong, and the one that drifted would be invisible.

**`CODER_REV` → 3, and no backfill was run.** The bump makes every rev-2 pulse eligible for
the owner-invoked backfill, which is correct and harmless: the tool is priced before it
runs and nothing presses it on its own. **The ambient sweep still ignores the rev
entirely**, re-pinned at the new rev by its own test — that invariant is what makes a bump
safe, and it is a billing bug that would look perfectly correct on screen.

**No chip, and the reasoning is in Appendix C so it is not revisited.** An effect proposes
a write somewhere else and needs a tap because the owner has not agreed to it yet. A
correction is a fact they just uttered, stored on the pulse that uttered it, exactly like
`nutrition`. Undo is deleting the pulse; the selector falls back to the item sum, or to
the correction before it.

Green: `vitest` 719 passed / 33 files (was 688 / 33) · `tsc -b` clean · `npm run build`
clean · `grep -rn "localStorage" src/` → 0 · lint 6 errors, all pre-existing.

**Gate 5 is unchanged and still open**, and this amendment is inside it: the calibration
week now also asks whether correcting a day by saying so actually works in the hand.

### 2026-08-29 — the interface underneath, rebuilt (audit; no phase)

Not a phase of this plan, and it changed no behaviour — but Gate 5's calibration week is
being run against these surfaces, so the week is now judging a differently-dressed app and
that has to be on the record.

**What changed under Pulse.** Nothing the coder does, nothing `dayNutrition` computes,
nothing `NutritionLine` decides. Only how they are set: the stream's lines move to the
reading face at the scale's `text-base`, the clock and the kebab stay mono at `text-xs`,
and the nutrition line stays exactly the four conditional parts it was — including the
provisional `of 1,800` target, still one array entry, still Gate 5's to settle.

**What changed everywhere.** Five hex themes became one OKLCH design in two lightnesses
plus system; the Read pane's separate palette was folded into the app's, so the app no
longer re-skins itself between panes; two faces replaced three; one five-step type scale
replaced thirteen sizes and ninety-seven arbitrary ones; and one `Section` grammar replaced
the mix of bordered cards and bare rules, so frames stop nesting. `docs/DESIGN_PRINCIPLES.md`
is the source of truth for all of it and must be read before any frontend change here.

**One thing a future session must not re-break.** Tailwind's `/opacity` modifiers do not
work on these tokens — a token holds a whole colour value, not channels, so `bg-accent/5`
compiles to *nothing at all*. Every accent tint in the app had been silently rendering
nothing. Named tints (`accent-wash`, `accent-rim`, `cite-rim`) are mixed in `index.css` and
used by name. Reaching for `/50` on a theme colour is the regression to watch for.

**Gate 5 is unaffected and still open.** The backfill is still unrun, the calibration week
still owes its ~15 spot-checks, and the target display is still the parked decision. If the
week's verdict is that the numbers are wrong, that is a `NUTRITION_RULES` question, not a
typography one — read `schema-before-model` before proposing a model swap.

### 2026-08-29 — a correction is a waterline, not a lid (Gate 5's first verdict)

The calibration week's first day produced a real failure, and this is the amendment it
earned. **The coder was not at fault** — it read *"I ate 100 cals worth of tofu"* as
`nutrition: {kcal: 100, kcalSource: "stated"}` on the right day, at rev 3, and the earlier
*"Saturday (today) 880 cals may be right .. but Friday it was more like 2400"* into two
correct corrections. Every model-side answer in the failure was right. The arithmetic
reading them was wrong.

**What broke.** `dayNutrition` treated a correction as replacing the day's item sum
outright. At 13:56 the owner ratified today at 880; at 14:39 they logged the tofu; the
line still read `880 kcal · of 1,800`. It had **discarded every calorie logged after the
ratification**, and — because `NutritionLine` never read `corrected` — it did so with
nothing on screen to say why. The correct behaviour and the bug were pixel-identical, which
is why this needed a day of living with it to find rather than a test.

**The rule now.** A correction is the owner saying what the day came to **as of the moment
they said it**. It subsumes everything eaten up to that instant and everything after it is
added on top: `kcal = correction.kcal + Σ items eaten after the utterance`. Strictly after,
so a meal counted in the same breath as the total ("had a burrito, 620 — so today's 1500 so
far") is inside it rather than added twice.

**One rule covers both kinds of correction, which is why there is only one.** A finished day
— *"friday was 2400"*, said on Saturday — has nothing eaten after the waterline, so it lands
on exactly the old answer; every one of the eight correction tests written at rev 3 passed
unchanged. A day still being lived keeps accruing. Nothing had to ask the coder to tell the
two apart, `PulseCorrection` did not change, and no event, prompt, migration or backfill was
involved: this was a selector, and the journal re-reads correctly as it stands.

**The waterline is capture time (`at`), and it is the one instant in `ledger.ts` that is not
`span.start`.** A correction is not a thing that happened at a time, it is an assertion made
at a time, and what it asserts is "everything up to *now*". Items keep bucketing by
`span.start`, so a Friday beer remembered on Sunday still lands on Friday and still sits
under a Saturday waterline — filed on the right day, and not added to a total that was
stated from memory of the whole of it.

**The Today line is now one number.** *"these multiple things like stated and estimated is a
nightmare for an ADHD brain"* — the owner's verdict on living with it, and the parked target
decision resolved with it. It printed as many as five figures (total · target · estimated
share · uncounted tally · protein); it now prints `980 kcal · of 1,800`. The estimated share
and protein are gone from this surface entirely: how much of a total rests on a guess is a
question asked while reviewing a week, and Energy's two-tone bars already answer it in the
one place it is asked. **The target stays**, still one array entry. The uncounted tally
survives as a `+` — `980+ kcal` — because dropping it outright would make the line lie about
a day with an unsizeable meal in it, and one character carries that fact with no second
figure and no word to decode. **Protein now renders nowhere**; `DayNutrition.proteinG` is
still summed and still tested, and giving it a home in Energy is unbuilt and unasked-for.

**`KcalBar` stopped branching on `corrected`.** A corrected day can now legitimately carry an
estimated share — the part eaten after the waterline — and the old branch drew that share as
though the owner had stated it. The bar goes single-tone on its own when there is nothing
after the waterline, which is every finished day. `DayKcal.corrected` is left in place and
now has no reader; deleting it is a separate cleanup, not this one.

Green: `vitest` 706 passed / 33 files (was 699 / 33; +6 waterline cases in `ledger.test.ts`,
+1 at the `PulseView` seam) · `tsc -b` clean · `npm run build` clean · `npm run lint` clean ·
`grep -rn "localStorage" src/` → 0.

**Gate 5 stays open.** This was one verdict out of three: correcting a day by saying so now
works in the hand, and the target display is settled. The estimate-quality question — are the
coder's numbers in believable range, is `uncounted` rare enough — still needs the week, and
is still a `NUTRITION_RULES` question if the answer is no. The backfill is still unrun.

### 2026-08-29 — pinned → guarded: an enrichment after a delete is not a pulse

Gate 5's second finding, and the second time the ledger has convicted arithmetic that was
behaving exactly as pinned. **This reverses a decision that was deliberate.** P2 pinned
enrichment-after-delete as resurrection and `pulse.test.ts` asserted it twice: the row came
back with `text: ''` and — since fence 1 forbids `enrichPulse` from carrying `at` — an epoch
`at`. It was pinned as a curiosity of the fold. The ledger made it a number on screen.

**What it cost.** A deleted food pulse kept its calories: the coder was already running when
the line was deleted, its enrichment landed last, and the entity came back carrying nutrition
and no utterance. The day's total counted a meal whose line the owner had removed, with
nothing on screen to attribute it to. A deleted **correction** was worse — a resurrected one
has no `at`, so its waterline sits at the epoch floor with the entire day after it, and a
retracted sentence outranked every real correction on that day forever.

**The rule now.** *A folded pulse that carries no `text` field was never captured on this
replica, and is not a pulse.* Absence of the field, not an empty string: `''` is an utterance
that folded to nothing, which is a capture, and stays visible. `readPulseRows` is the single
gate, so stream, sweep, backfill, ledger and corrections all inherit it from one line.

**`fold` is untouched, and must stay untouched.** Journal-level resurrection is a CLAUDE.md
invariant for all twelve entities, and a replica that fetches the delete later has to converge
on the same state as one that fetched it first. The fold still resurrects the entity; the row
reader is where it stops. This is the pulse row reader's contract, not the journal's — which
is why there is no schema change, no migration, no coder rev, and no fence touched. The
journal re-reads correctly as it stands.

**`enrichPulse` also returns without writing when the row is gone** — belt for the
single-device race, keeping the orphan out of the journal rather than merely out of the
reader. This one has a real cost and it is recorded on purpose: **L4 is reversed.** A row
absent from this session used to be written blind, because absence may mean a `resetSession()`
landed mid-call rather than a delete, and the two are indistinguishable from there. Skipping
costs a coder round trip — an uncoded pulse stays visible to the sweep and is picked up again.
Writing blind costs a ghost the reader must filter forever. The recoverable failure wins.

**Tests.** The two P2 pins in `pulse.test.ts` now assert the opposite; the `fold()` half of the
fold test is unchanged and still pins resurrection, which is the point. Three added to
`ledger.test.ts` — a deleted meal beside a kept one, a deleted correction falling back to the
item sum, and a hand-built cross-device journal (A captures, A deletes, B enriches) whose fold
is asserted to still resurrect before the reader is asserted to exclude it. That last one is
the only ledger test that fails if the reader gate alone is removed; the other two are covered
by the `enrichPulse` guard, which is the division of labour the two deltas were written to.

### 2026-08-30 — the retry is picking your phone back up

Gate 5's third finding, and the first one that is about **fuss** rather than arithmetic.
*"we need pulse to really be extremely fuss free - else it doesnt work - this is for an adhd
person."* That is the acceptance criterion this entry is written against.

**What happened.** A Saturday dinner captured at `2026-08-30T01:48:50Z` — *"Btw yesterday
(Saturday) dinner I had half tandoori roti, half paneer butter masala, and half chole"* — was
never coded. Diagnosed by folding the real journal: it was the **only** uncoded pulse in it,
with a pulse two minutes earlier and one an hour later both coded at rev 3. So the key, the
model and the prompt were all fine; one call was dropped, `codeRow` swallowed it as it swallows
everything, and nothing on screen said so. The ledger was simply missing a meal.

**Why it stayed broken.** The backlog sweep ran in a `useEffect` with stable deps — **once per
mount of the Pulse view**. An installed PWA that is backgrounded and resumed does not remount,
and `codeCapturedPulse` is deliberately one line and not a re-walk, so the next capture did not
rescue it either. The pulse would have waited for a cold launch.

**The rule now: the sweep also runs on foreground**, on the same `visibilitychange` / `focus`
pair `installSyncTriggers` already uses. Picking the phone back up is the retry, and it is the
only retry an owner should ever have to perform.

**`SWEEP_MIN_INTERVAL_MS = 5 min` is what keeps that from becoming a bill**, and it is
load-bearing rather than tidy. A pulse the coder DECLINES stays uncoded on purpose — fence 2's
null coding is a finished outcome, not a failure — so it is a candidate again on every sweep.
Without a floor, a phone picked up fifty times pays for that pulse fifty times. Every sweep
stamps the clock, not just the foreground one, or a pickup moments after an open walks the same
backlog twice. Both halves are pinned in `usePulses.test.ts`.

**The count was lying, and that is a second reversal.** `pulsesToBackfill` selected
`(coderRev ?? 0) < CODER_REV`, which by design lumped *never coded* together with *coded at an
older rev*. The docstring argued for it explicitly and it was right until a revision shipped.
Measured on the real journal the day this changed: **1 uncoded, 18 at rev 2** — and the owner
asking "did my dinner get processed?" was shown *"19 pulses, roughly $0.19"*. The number could
not answer the only question being asked of it.

**Two disjoint sets, two numbers, two decisions.** `pulsesToCode` is the backlog — never coded,
and normally zero now that the sweep reaches it unattended. `pulsesToBackfill` keeps the Gate 5
catch-up tool and now requires the pulse to be *coded* already. `countPulseCodingWork` returns
both from one read of the journal, so the two figures on screen cannot disagree about it.

**Settings counts on mount instead of waiting for a tap.** The count is a local read and costs
nothing; requiring a tap meant the owner had to already suspect something was owed before the
app would tell them, which is the exact fuss this entry is about. The two-tap *confirmation*
property is untouched — each price still sits beside its own run button before it is pressed,
which is why there is still no "are you sure" modal.

**The manual button still writes `codingOnly`.** Effects and vocab proposals are omitted on
both piles, unchanged: a button that could tick something in the app is a fortnight of history
reaching forward into today. The automatic path is the one that gets a full coding, because it
runs minutes after capture rather than weeks. That asymmetry is deliberate.

### 2026-08-30 — the coder had nowhere to think, and a third of codings died there

The retry shipped this morning worked, and the pulse it was built for still would not code.
Pressing *code 1* returned **"1 of 1 done · 1 failed"** — two bugs in seven words.

**The real one, reproduced against the live API rather than reasoned about.** `codePulse` sent
`thinking: {type: 'disabled'}`, on the stated reasoning that a classification call needs no
reasoning and reasoning would compete with a 500-token ceiling meant entirely for the answer.
What the model actually did, given nowhere to reason, was reason **in the visible text**: a
prose preamble and a ` ```json ` fence around an otherwise perfect coding. `parseCoding` runs
`JSON.parse` on that block and does not go hunting inside it, so it returned null — and null is
also what a dead network returns, so the pulse stayed uncoded with nothing able to say why.

**Measured, not guessed.** Three real pulses from the owner's own journal, six runs each, the
real system prompt and payload: **12/18 parsed before, 18/18 after.** A third of every coding
this app has ever attempted was being thrown away silently. That is the failure the Saturday
dinner was a visible instance of; the two pulses either side of it coded because they won the
coin flip.

**The rule now: `thinking: {type: 'adaptive'}` with `output_config: {effort: 'low'}`.** The
thinking replaces the preamble the model was already paying for, so the bill did not move —
189 output tokens before, 186 after. `MAX_OUTPUT_TOKENS` rose 500 → 2000 because thinking
spends from the same ceiling and a coding cut off at `max_tokens` is rejected outright.

**Do not teach the parser to find JSON inside prose.** That is a string rule over model output
and it is the fence this file already names. A wrapped coding is pinned as null in
`coder.test.ts`, deliberately, so the fix stays upstream.

**No `CODER_REV` bump.** The output contract did not change — only the request config did. The
failures produced no coding at all rather than a worse one, so nothing already stored is stale
and no re-code is owed by this.

**The second bug: the progress line contradicted itself.** It read `done + failed` and labelled
that "done", so one pulse that failed printed *"1 of 1 done · 1 failed"*. `done` is what landed,
never what was attempted. It now reads *"none of 1 coded · try again"*, and only mentions
failures alongside a non-zero success count.

**Not built, and worth naming.** `SettingsView` has no test file, so the progress line is fixed
and unpinned — a test for it would mean standing up a render harness for one display string.
Ask before building it.

### 2026-08-30 — a dinner at lunchtime, and the waterline that ate it (coder rev 4)

Saturday read **1,309** when it should have read **1,749**. The arithmetic was right, every
time — 880 (the ratification) + 100 (tofu) + 329 (smoothie). The 440-kcal dinner was missing,
and the reason was one field.

**What happened.** The retry shipped that morning worked and the Saturday dinner finally coded:
440 kcal, `approx: true`, the right day. Its span start was
`2026-08-29T12:30:00.000+08:00` — **half past twelve, for a dinner.** The day's correction was
stated at 13:56 local, and a correction subsumes everything eaten before it, so the meal landed
an hour and a half on the wrong side of the waterline and contributed nothing. Nothing on
screen could say so: a subsumed item looks exactly like an item that was never there.

**Why the model guessed.** `RULES` said only *"time expressions resolved against now and tz"*.
That answers **which day** and says nothing about **which hour**, so for an utterance naming the
meal but not the clock, there was no rule to follow. This is `schema-before-model` exactly: the
wrong answer was a missing instruction, not a weak model.

**Measured before changing anything**, eight runs per case against the real API:

| utterance | before | after |
|---|---|---|
| "yesterday (Saturday) dinner…" | Sat 19:30 ×8 | Sat 19:00/19:30 ×8 |
| "had dinner - dal, rice and some bhindi" | **`now` — Sun 09:48 ×7**, Sat 19:30 ×1 | evening ×7, ×1 wrong day |
| "yesterday's breakfast was 2 idlis and sambar" | Sat 08:00 ×5, 08:30, 09:00, **00:00** | Sat 08:00 ×8 |

The pulse that started this is not the interesting row — it codes correctly eight times out of
eight. **A plain "had dinner" landing at `now` seven times out of eight is**, and that had been
true of every meal logged without a clock time since phase 5 shipped.

**The rule now (`SPAN_RULES`):** a meal's span is when it was EATEN; with no clock time given,
place it at the ordinary local hour for that meal in `tz` and set `approx`; never place a dinner
before the afternoon. It states *why* in the prompt too — the hour decides the day the food
counts on and which side of a correction it falls on — because that is the part the model was
never told mattered. Judgment in prose the model reads; there is no meal-time table in the
codebase and there must never be one (fence 2).

**`CODER_REV` 3 → 4, and this is the first bump for a PROMPT change rather than a schema one.**
That is deliberate and it is the right use of the mechanism: a rev-3 coding can carry a meal at
an hour that makes it silently not count, and only a re-code can fix such a row. It is also what
gives the owner a way to repair Saturday — the re-code button, which now has 19 pulses in scope.
A bump is a bill, and this one buys back a day that was wrong.

### 2026-08-30 — pulse manages its own coding; two settings deleted

*"pulse needs to be able to manage all of this"* — and *"if you need to delete older stuff to
make a better product, do it"*. Both settings the owner was asked to operate are gone, and the
work behind them now happens by itself. **211 lines out of `SettingsView`, 147 net out of the
app.**

**A rev bump catches itself up, once.** `codeUncodedPulses` now finishes by re-coding anything
below `CODER_REV`, gated on a device-local `codedAtRev` mark written only after a pass finds
nothing left. Fixing Saturday used to mean noticing the number was wrong, understanding what a
coder revision is, finding Settings and pressing a priced button. It now happens on the next
foreground.

**This is not the ambient sweep learning about `coderRev`, and the distinction is the whole
safety argument.** The fence exists because re-coding everything below the current rev on every
open re-bills the entire history, silently, forever — a billing bug that looks perfect on
screen. `codedAtRev` makes the work at most once per revision per device; every later open
short-circuits before it reads a row. The fence's own regression test is rewritten to pin
exactly that: one call across five opens, and zero on a device already current. A failed pulse
keeps its old rev and the mark is not written, so a partial run resumes.

**Pulse effects: the switch is deleted and the one effect left just applies.** Settings said
*"a coding proposes; you tap. switch one on and it applies itself as a coding lands — never
reaching back over pulses already coded."* Phase 4 had already retired every effect but
`claimEvent`, so that copy described a general system that no longer existed — which is why it
read as nonsense. There is no decision worth a switch here: linking a pulse to a calendar event
it names is either right or the coder should not have proposed it. `autoApplyClaimEvent` is
gone from `MetaKey`, and `get/setPulseEffectAutoApply` with it.

**The chip code stays, as the fallback it now is.** An effect stored by an older build, or one
whose auto-apply threw, still renders a tappable chip — pinned by a test that seeds such a row
straight into the journal, because the coding path no longer leaves one behind.

**The Settings coding block is deleted too.** Both piles now clear themselves — the backlog on
foreground, the rev on the catch-up — so a count and two priced buttons were UI for work the
app already does. `pulsesToCode`, `pulsesToBackfill` and `backfillPulseCoding` survive as the
mechanism; nothing in the interface asks the owner about them.

**What this costs, stated plainly.** A rev bump now spends without asking. It is bounded by the
history, paid once per device, and only happens when the coder itself changed — and the
alternative was measured this week: a fix nobody presses is a fix that did not ship.

### 2026-08-30 — the app was live and the phone was not

*"saturday still show 1309 only"*, hours after the fix deployed and the Pages build went green.
The fix was correct and the owner could not have it.

**`registerType: 'autoUpdate'` updates the WORKER, not the page.** The new service worker
installs and takes over, and a page that is already open keeps running the JavaScript it
loaded. An installed PWA that is backgrounded and resumed never reloads — that is what makes it
feel like an app. So every fix this week landed behind a force-quit the owner had no reason to
perform, and the foreground sweep faithfully re-ran the *old* code.

**`onNeedRefresh` now reloads the page**, guarded so one bad worker cannot loop. Safe to do
unannounced because every write is durable before it can happen: capture reaches the outbox
before the line renders, and the outbox survives a reload by construction. There is nothing
unsaved in this app to lose.

This is the same lesson as the coding retry, one level up. *A fix the owner has to do something
to receive is a fix that has not shipped* — and "something" includes knowing that a PWA caches
itself.

**The count came back, as a status line.** Deleting the two priced buttons was right; deleting
the NUMBER with them was not, and *"where has the count part gone??"* was the immediate verdict.
The owner still has to be able to see whether anything is owed. It now reads
*"27 being brought up to date — happens on its own, a few at a time"* or *"every pulse is coded,
and current."* — a read of the local store, with nothing to press. Visibility is not fuss;
being asked to act is.

### 2026-08-30 — newest first: the queue was fixing what nobody could see

*"i dont see count, nor do i see saturday 1749 .. i have reopned multiple times on phone and
cmd+r on laptop - nothing is changing"*. It was changing. Verified from the journal: nine
pulses had already been re-coded to rev 4 at 04:46–04:48Z, and the live bundle contained every
line of the fix. The owner was right anyway, because none of the nine were rows they could see.

**`pulsesToBackfill` sorted oldest first, so the Saturday dinner was 27th of 27.** Oldest-first
was correct while this was a button the owner pressed and watched — a stopped run had finished
the oldest half, and pressing again resumed where the eye left off. The moment the catch-up
became automatic and paced (a few per foreground, floored at five minutes), that same order
decided **when the owner sees anything change at all** — and what an owner looks at is this
week. Reversed to newest first.

**The lesson repeats, and it is worth naming.** Every failure this week was a fix that was
correct and unreachable: a coding retried only on cold launch, a build the phone would not
load, and now a queue working backwards from the wrong end. Being right is not the same as
landing, and the only test that counts is the owner seeing the number change.

### 2026-08-30 — the catch-up was hostage to one screen

*"no change on both"*, after a reload that was serving the right bundle and a queue that had
already re-coded nine pulses. Verified from both ends this time — the live bundle contained
every line of the fix, and the journal showed rev-4 events at 04:46–04:48Z. Then nothing.

**`codeUncodedPulses` runs inside `usePulses`, and its sweeper aborts when the Pulse view
unmounts.** That is right for the backlog it was written for — a glance at Pulse should not
leave a queue of paid calls running behind the app. Hanging the rev catch-up off the same
function inherited the leash: twenty-seven pulses at one paid call each is about six minutes of
sitting on a single screen and doing nothing else, and navigating away cancelled it. Nine
landed because that is how long the owner happened to stay.

**The catch-up now runs from the app shell** (`AppContext`), on mount and on becoming visible,
carrying no abort signal. Navigating between views must not cancel work the owner never asked
for and cannot see. It is still bounded by `MAX_PULSES_PER_SWEEP` per pass, still marked once
by `codedAtRev`, and now returns whether it re-coded anything so a device already current costs
one IndexedDB read and repaints nothing.

**`scheduleFlush` moved inside the loop.** A run cut short — tab closed, phone locked — now
ships what it already paid for instead of dropping it to the next pass.

**Three times this week the same shape.** A coding retried only on cold launch. A build the
phone would not load. A queue that only advanced while one screen was open. Each fix was
correct and each was unreachable, and the only signal that separates those two states is the
owner saying nothing changed.

### 2026-08-30 — a status line you have to be told how to find is not shown

Saturday came right — the dinner re-coded to 19:00 and the day reads 1,824 (the re-code also
moved the smoothie 329 → 389 and the dinner 440 → 455). The count did not.

**It was rendering the whole time.** Verified on a clean profile against the live site: the text
*"every pulse is coded, and current."* was in the DOM. The owner still could not see it, and
that is the finding, not a misunderstanding to correct. It sat as `text-text-muted` prose at the
foot of the **ai** section, below a textarea, in a settings page long enough to scroll.

**Two things were wrong and both are mine.** It was placed where nobody would look, and it
answered a question that had not been asked: *"how many?"* was met with a sentence containing no
digits. Being told where to find it and still not seeing it is the proof — a thing you need
directions to reach has not been shown.

**Now:** its own `<Section label="coding">`, and always a number —
*"27 pulses · all coded and current"*, or *"27 pulses · 5 still catching up"*, with one muted
line underneath saying it happens on its own and there is nothing to press. `countPulseCodingWork`
gained `total` for exactly that reason.

Deleting the buttons was right. Deleting the number was not, and neither was whispering it.
