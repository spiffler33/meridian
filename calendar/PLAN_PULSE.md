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

## How to execute this plan

- **One phase per run. Stop at every gate.** Owner reviews on device between phases and
  may amend this file before the next run.
- Work lands on `local-first`. Never push `main` mid-phase.
- Each phase ends: `vitest` green, `grep -rn "localStorage" src/` → 0, gate checklist met.
- Conflicts with `CLAUDE.md` ⇒ stop and ask. `CLAUDE.md` wins on journal, sync, tokens.

## Context

| thing | value |
|---|---|
| Repos touched | `meridian` only. `meridian-data` gains two entities via normal journal writes. |
| New entities | `pulse` (#11), `pulseVocab` (#12) — Appendix A. Nothing else. |
| Volume | dozens of pulses/day ≈ a few MB/year of journal — normal compaction rules apply, no special casing. |
| Coder model | Haiku-class (`claude-haiku-4-5`), via the existing `claude.ts` plumbing (key from `meta`, direct-browser header, error taxonomy). |
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

**Goal:** interstitial journaling ships. Timestamped verbatim lines, instant, offline.
Already valuable with no intelligence in the loop — that is the point of the layering.

Build:
- **Entity #11 `pulse`** (Appendix A). Capture writes `{text}` only; envelope `ts` is the
  timestamp; id comes from the house generator `newId()` (a stream, not keyed state).
  Derived fields are
  *documented now, written only in Phase 2*. Delete = tombstone via the normal path
  (long-press / kebab on a stream line). No edit in v1 — delete and retype keeps
  verbatim semantics trivial.
- **Capture box** pinned at the top of TodayView in the cleared header region. One field,
  no pickers, no buttons. Placeholder: `what's happening…`. Enter → outbox → optimistic
  render → field clears. Empty Enter is a no-op. Global `P` navigates to Today and
  focuses the box.
- **Today stream** directly under the box: the day's pulses, **newest-first** (most
  recent utterance adjacent to the box — a deliberate call; chronological day-tape
  reading can come later if the gate demands it). Line = mono `HH:MM` + text in the
  reading face ~14.5px. Yesterday and earlier are not shown here (Year/stats own the
  past).
- Pulses do not yet appear anywhere else (no heatmap, no stats).

Tests: pulse fold (create, tombstone, resurrect), day-filter + order selector, `P` focus,
optimistic render + outbox flush reuse, old-`ENTITY` skip simulation for `pulse`.

**GATE 1:** three real days of use. Is capture genuinely frictionless on the phone
(taps-to-writable-surface ≈ zero)? Is newest-first right, or reverse it? STOP.

---

## Phase 2 — The coder (classification, vocabulary, chips, Tower convergence)

**Goal:** the AI layer's daily-life form: invisible classification along five dimensions,
side-effects as proposals, one parser serving two mouths.

Build:
- **`src/services/coder.ts`** — `codePulse(text, context) → Coding` via one Haiku call
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
  Today mouth codes unbiased: `signal: task` there proposes `spawnTask`.
- Cost note in code comment: dozens of Haiku calls/day ≈ pennies/month; no caching.

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
on their own. STOP. Plan complete.

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
| `signal` | enrichment | coder — `block · event · state · plan · task · claim · note` |
| `domain` | enrichment | coder — from vocab domains |
| `activity` | enrichment | coder — short label |
| `people[]` | enrichment | coder — aliases from vocab |
| `span` | enrichment | coder — `{start, end?, approx?}`; start defaults to `ts`, back-dated when stated ("this morning" ⇒ approx) |
| `links` | enrichment / chip apply | `{habitId?, towerId?, eventId?}` |

**#12 `pulseVocab`** — natural key `vocab`, one instance.

| field | shape |
|---|---|
| `domains[]` | seed: `db · hoa · family · home-ops · self · social · transit · admin` |
| `activities` | `{label → domain}` seed: `gym→self, read→self, deep-work→db, school-run→family, dinner→family, drinks→social` |
| `people[]` | seed: `wife, kids` (grows via proposals) |
| `habitAliases` | `{alias → habitId}` seed mapping `gym/lift/strength` → strength habit id, `read` → reading habit id (resolve real ids at seed time) |

Seeding: first Phase 2 run, iff unset — one journal event, idempotent across devices.

## Appendix B — Coder contract

**Context allowlist (fence 5) — the payload contains these slices and nothing else:**
`text` · `now` (ISO) · `tz` · `vocab` (full) · `todayEvents[{id,title,calendar,start,end}]`
· `todayHabits[{id,name,done}]` · `openTowerItems[{id,text,status}]` ·
`recentPulses` (last 5: `{text, coding?}`) · `mouth` (`today` | `tower`).

**Output (strict JSON, nothing else):**
```json
{
  "signal": "block|event|state|plan|task|claim|note",
  "domain": null, "activity": null, "people": [],
  "span": {"start": "...", "end": null, "approx": false},
  "links": {"habitId": null, "towerId": null, "eventId": null},
  "effects": [{"type": "completeHabit|spawnTask|updateTask|claimEvent", "...": "..."}],
  "vocabProposal": {"kind": "domain|activity|person|habitAlias", "value": "...", "mapsTo": null}
}
```
Rules given to the model: nulls over guesses; `signal` always set (`note` when unsure);
never invent people, habits, events, or tasks not present in context; time expressions
resolved against `now` and `tz`; `mouth: tower` biases toward `task`.

## Appendix C — Effects & chips

| effect | applies | default |
|---|---|---|
| `completeHabit` | ticks today's habit completion (timing analytics read the pulse span, not the habit record) | confirm |
| `spawnTask` | creates Tower item, sets `links.towerId` | confirm |
| `updateTask` | proposes status/waitingOn/expectsBy on a matched open item | confirm |
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
