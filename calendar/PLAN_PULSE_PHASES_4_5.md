# ADDENDUM — PLAN_PULSE.md: Phases 4 & 5

Paste-over instructions: append the two phases below to `docs/PLAN_PULSE.md` after
Phase 3, apply the appendix amendments at the bottom, and add fence 9 to the Hard
fences list. **Neither phase begins until GATE 3 has passed.** One phase per run,
stop at every gate, as ever.

**New hard fence 9 (add to the global list):**
9. **Habits and Tower are manual, intentional spaces.** No AI reads them, writes them,
   proposes about them, or receives them as context. Habit creation/edit/tick and Tower
   item creation/edit happen through their own UIs only, forever. The coder observes
   and classifies the owner's utterances; it is not an actuator.

---

## Phase 4 — Decommission actuator effects (the coder becomes a pure observer)

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

**GATE 4:** live with it several days. Two questions, both real: (a) do you miss "done
with the deck" closing the item from the box, or does walking to Tower feel right — is
the intentionality tax worth it in practice, not just in principle? (b) with only claim
and vocab chips left, is the stream calmer? STOP.

---

## Phase 5 — Nutrition ledger (calories + protein; arithmetic only)

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

## Appendix amendments

**Appendix A (`pulse`)** — add rows:

| field | written | by |
|---|---|---|
| `nutrition` | enrichment | coder — `{kcal, kcalSource, proteinG?, proteinSource?}`; `kcal: null` = recognized consumption, uncounted; absent = not food |
| `coderRev` | enrichment | coder — schema revision of the coding; absent ⇒ pre-rev-2 |

`links` row becomes `{eventId?}` only. **Appendix A (`pulseVocab`)** — remove
`habitAliases`; add `eating → self` to the activities seed.

**Appendix B** — context allowlist becomes: `text · now · tz · vocab ·
todayEvents[{id,title,calendar,start,end}] · recentPulses (last 5)`. `todayHabits`,
`openTowerItems`, and `mouth` are removed. **The nutrition feature adds nothing to the
context — the text already carries everything.** Future sessions: do not "helpfully"
enrich the context; this sentence exists so you don't. Output schema: effects enum is
`claimEvent | vocabProposal` only; add the `nutrition` object and `coderRev` as above.

**Appendix C** — table shrinks to `claimEvent` and `vocabProposal`, both confirm-only
as before.
