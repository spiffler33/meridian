# PLAN — Calendar in meridian (mirror-read, three phases)

Meridian gains the day's real shape: events from `spiffler33/calendar-data`, a private repo
written only by its own scheduled Action (see that repo's README). Meridian reads it exactly
like it reads newsletters. Google Calendar remains the editing and alerting surface — we
mirror it, we do not rebuild it.

## How to execute this plan

- **One phase per run. Stop at every gate.** Owner reviews on device between phases and may
  amend this file. Phase 3 is optional and runs only if the owner asks for it by name.
- Work lands on `local-first`. Fast-forward `main` and deploy whenever the owner wants to
  check on the real device — that is the only place the read token and the real mirror are.
  The one-way v2→v3 IndexedDB migration means any problem is fixed forward, never reverted.
- Each phase ends: `vitest` green, `grep -rn "localStorage" src/` → 0, gate checklist met.
- Conflicts with `CLAUDE.md` ⇒ stop and ask. `CLAUDE.md` wins on journal, sync, tokens.

## Hard fences (all phases)

1. **The app never writes to `calendar-data`.** The Action is the only writer.
2. **Events are a mirror, never journal.** They live in `contentCache` only. The journal is
   for state the owner authors; mirrored third-party data in an append-only-forever log is
   bloat with someone else's source of truth. No `event` entity exists. Ever, in this plan.
3. Transport stays **trees + blobs** (reading-pane fence 2 applies unchanged).
4. One read token serves both mirrors: the existing read-only fine-grained PAT, extended on
   github.com to select `calendar-data`. Same `meta` key; same never-log/never-URL rules.
5. **No Google OAuth in this plan.** If live freshness or write-actions are ever wanted,
   that is a new plan with a new trust model — not a phase here.
6. Title hygiene for the work calendar is enforced **at source** (owner discipline +
   `PRIVATE_CALS` in the mirror). Meridian renders what arrives; it does not redact.
7. Staleness is surfaced honestly: `generated_at` older than 90 min during 06:00–24:00 SGT
   shows an amber "mirror stale since HH:MM" note wherever events render. Silent staleness
   is a bug (same doctrine as backup status).
8. Design: setpoint tokens; calendar is an **instrument** — mono type, calendar-dot accents
   per Appendix B. No decorative timeline art.

---

## Phase 1 — Multi-repo transport + calendar data layer

**Goal:** the reading pane's transport generalizes to N repos; `events.json` parses; Settings
tells the truth about the mirror. Nothing renders in Today/Week yet.

Build:
- Generalize `src/lib/newsletters.ts` → `src/lib/gitread.ts`: same five calls
  (`verifyReadAccess`, `getHeadSha`, `getTree`, `getBlob`, sync-diff), parameterized by
  `{owner, repo}`. Newsletters call sites migrate; behaviour identical.
- **`contentCache` keys gain a repo namespace: `<repo>:<path>`.** IndexedDB `meridian`
  **v2 → v3**: `onupgradeneeded` rewrites existing bare keys to `newsletters:<path>`
  in place and touches nothing else. Migration test proves v2 data (both stores' content)
  survives byte-identical apart from keys.
- Per-repo meta: `gitread:<repo>:headSha` (+ fetchedAt). Old `nlHeadSha` is dropped, not
  migrated — cost is one extra tree fetch on first run, which is fine.
- `src/lib/calendar.ts`: parse `events.json` per the schema in `calendar-data`'s README.
  Malformed file ⇒ typed error surfaced in Settings, never a throw into render. Selectors
  (pure, tested): `eventsForDay(date, tz)`, `eventsForWeek(weekStart, tz)` — UTC→device-tz
  conversion, all-day handling (**end date exclusive**), sort all-day first then by start.
- Sync-on-open/focus: calendar-data joins the same head-sha-first flow; `events.json` is
  state-tier (fetched when changed, small).
- Settings: "Calendar mirror" block — last `generated_at`, event count, staleness state,
  verify against the shared read PAT.

Tests: parser (good, malformed, all-day exclusivity, tz), key-namespace migration v2→v3,
selector day/week edges (midnight-crossing event, week boundary Sunday/Monday per existing
week convention), staleness threshold function.

**GATE 1:** Settings shows the mirror synced with a believable count; airplane-mode open
still serves cached events; journal untouched (`meridian-data` log shows zero new lines
from this phase). STOP.

---

## Phase 2 — Render: Today gets its day-shape, Week gets its lanes

**Goal:** the owner sets MITs against the actual day. Read-only, instrument-styled.

Build:
- **TodayView — "Day shape" strip** above/beside MITs:
  - All-day chips first (mono, hairline border, calendar dot).
  - Timed events in order: `HH:MM–HH:MM` mono · title · calendar dot (Appendix B colors).
  - Past events muted (`--faint`); the **next-up** event carries the amber pip treatment
    (borrowed from setpoint's focus pip — one accent, not a light show).
  - Location renders only if present, muted, truncated to one line.
  - Empty day: "no events mirrored today" — a statement, not an alarm. Stale mirror: the
    fence-7 amber note as a strip footer.
- **WeekView:** under each day's existing content, a stacked mini-list — up to 5 events
  (`HH:MM title`, mono 12px) then `+n`. All-day chips inline. Same dots, same muting for
  past days.
- No event detail view, no tap-through in this phase — titles are the payload; Google is
  one swipe away for depth. (Keeps scope honest; revisit only if the gate demands it.)
- Fixtures for both views incl. midnight-crossing and all-day multi-day spans.

Tests: strip ordering (all-day → timed), next-up selection at boundary times, week lane
cap/+n, muting rules, stale-note rendering.

**GATE 2 — the real test happens at 07:00 with coffee:** set tomorrow's MITs against the
strip on the phone. Does the day's shape change what you pick? If it doesn't, Phase 3 has
nothing to synthesize — say so before proceeding. STOP.

---

## Phase 3 (OPTIONAL, owner-invoked) — "Shape my day": the first assistant seam

**Goal:** the first sanctioned piece of the AI layer. One button on TodayView that turns
commitments + intentions + inputs into a grounded note. Advises, never acts.

Build:
- Button "Shape my day" on TodayView (and nowhere else). On tap, one client-side call via
  the existing `claude.ts` plumbing (`claudeApiKey`, direct-browser header, existing error
  handling). **Never auto-runs.**
- Input assembly (a pure, testable function — the prompt sees a derived slice, never raw
  stores): today's events `{start, end, title, calendar}` · today's MITs `{text, status}` ·
  habits due today `{name, done}` · Read unread count (single integer). **Nothing else.**
  No journal history, no reflections, no reading content, no tokens, no location beyond
  what an event title carries.
- Contract in Appendix C: 4–6 sentences, plain text, names the actual free gaps by time,
  slots the MITs, flags at most one conflict/risk. No headers, no bullets, no praise, no
  generic advice. `max_tokens` 400. Model `claude-sonnet-4-6`.
- Cache the note for the day in `meta` (`dayShape:<date>`); repeat taps are free; a
  "regenerate" affordance bypasses the cache.
- Offline / no key / API error ⇒ the button explains itself in one line; the strip still
  stands alone. The feature degrades to absence, never to breakage.
- **At this gate the owner decides the fate of the daily insight** (fortune cookie): keep,
  or deprecate in favour of this. Record the decision in this file.

Tests: input-assembly slice (proves the allowlist — build a fixture state and assert the
assembled payload contains nothing outside it), day-cache keying, error/offline states.

**GATE 3:** a week of real mornings. The note must have changed a decision at least once —
otherwise it's the horoscope with a calendar, and it should be turned off without
sentimentality. STOP. Plan complete.

---

## Appendix A — Data source

Schema, window, timing, and security posture are owned by `calendar-data/README.md`.
Meridian treats that README as the contract; parser changes follow schema changes there,
never the reverse.

## Appendix B — Calendar accents

| calendar | dot |
|---|---|
| `home` | `--green` |
| `personal` | `--ice` |
| `db` | `--amber` |
| anything else | `--muted` |

Dots are 7px, matching the Library unread dot geometry. The dot is the only per-calendar
color; titles stay `--ink`/`--muted` — the strip is an instrument, not a rainbow.

## Appendix C — "Shape my day" prompt contract (sketch, finalize in-phase)

System intent: *You are the day-shape note inside a personal cockpit. Input is JSON:
events, MITs, habits due, unread count. Write 4–6 plain sentences. Name the real free
gaps by clock time and say which MIT goes where and why it fits that gap. If commitments
collide with an MIT or the day is overpacked, say so once, plainly. If the day is light,
say what that's good for. No headers, no lists, no motivation, no praise, no restating
the calendar back. Singapore timezone.*

Determinism note: temperature default; the day-cache makes reruns deliberate rather than
slot-machine.

---

## Run log

### 2026-08-27 — Phase 1: multi-repo transport + calendar data layer

Green: `vitest` 462 passed / 23 files · `tsc -b` clean · `npm run build` clean ·
`grep -rn "localStorage" src/` → 0 · lint 6 errors, all pre-existing.

New: `src/lib/gitread.ts`, `src/lib/calendar.ts`, `src/lib/calendarSync.ts`,
`src/hooks/useCalendar.ts`, `src/components/CalendarSettings.tsx`, and tests for each.
Gone: `src/lib/newsletters.ts` (became `gitread.ts`).

**The namespace lives in `db.ts`, not in its callers.** `getCachedContent(repo, path)` /
`putCachedContent(repo, record)` / `cachedContentShas(repo)` take the repo and deal in plain
repo paths; the `<repo>:<path>` key is added and stripped inside. Callers cannot forget to
apply it, and `ContentCacheRecord.path` still means what it says.

**The v2→v3 rename is a delete and a put, not `cursor.update()`.** The record's `path` field
*is* the store's keyPath, and updating a record to a value whose key path evaluates to a
different key is a `DataError` that aborts the whole upgrade transaction. Found by the
migration test, which is the only reason it was not found on a device.

**`nlHeadSha` / `nlTree` / `nlTreeFetchedAt` are deleted by the upgrade**, as the plan said —
not renamed. Cost is one tree fetch on the first open after updating.

**One token, and the meta key keeps its old name.** `newslettersToken` now serves both mirrors
(fence 4). Renaming it to something repo-neutral would have been tidier and would have made
every device re-enter the PAT for nothing.

**`eventsForWeek(weekStart, tz)` shipped as `eventsForDays(mirror, dates, tz)`.** The week view
already computes its seven dates with `getWeekDates(date, weekStartsOn)`, which is where the
Monday/Sunday convention lives; a selector that took a week start would have had to duplicate
that convention and could then disagree with the view above it. It buckets in one pass and
returns every date asked for, empty ones included, so Phase 2 can render without existence
checks. **Amend this if you want the original signature back.**

**Staleness is arithmetic on the epoch, not an `Intl` timezone lookup** — Singapore has had no
DST since 1935, so SGT is `+08:00` forever, and `isMirrorStale` is quiet before 06:00 SGT
because the action is not scheduled then. 90 min = two missed runs.

**All-day events never pass through a timezone.** Their dates are literal in every zone and the
end date is exclusive. Timed events appear on every local day they touch, so a 23:00–01:00
meeting is on both days and one ending exactly at midnight is only on the first.

`useCalendar()` is mounted in `AppContent`, not in a view: the mirror must already be current
when the day is first looked at. Its result is unused until Phase 2.

**Not built, deliberately:** nothing renders in Today or Week yet — that is Phase 2.

### 2026-08-27 — Phase 2: the strip on Tower, lanes in Week

Green: `vitest` 488 passed / 25 files · `tsc -b` clean · `npm run build` clean ·
`grep -rn "localStorage" src/` → 0 · lint 6 errors, all pre-existing.

New: `src/components/DayShape.tsx`, `src/components/calendarUi.tsx`,
`src/components/DayShape.test.tsx`, `src/views/WeekView.test.tsx`, plus `timeLabel`,
`dayShape` and `deviceTimeZone` in `calendar.ts`.

**The strip went on TowerView, not a "TodayView" — there is no TodayView.** The nav is
tower · habits · week · year · read · settings. MITs still exist in the data model
(`dailyData.mit.work/self/family`, counted by WeekView) but nothing renders them for editing
any more; TowerView replaced that surface and is what the app opens to. So the strip sits
directly above **Now**, which is where the day's commitments actually get chosen. `DayShape`
takes all its inputs as props, so moving it to HabitsView is one line if this is wrong.

**"Next" means the first timed event that has not finished**, so a meeting you are sitting in
is the one lit, not the one after it. All-day events are never lit and never muted — they are
the day's context, and marking one would spend the single accent on a whole-day fact.

**`now` is read at render, and there is no ticker.** The strip refreshes when the app takes
focus (the calendar sync sets state), which is when a phone is actually looked at. A
`setInterval` re-render each minute would make the pip live while the app sits open.
**Declined by the owner, 2026-08-27** — it only bites with the app left open on the laptop,
and use is mostly phone, where focus already re-renders. Do not re-offer it.

**The dot and the all-day chip live in `calendarUi.tsx`**, on the `readUi.tsx` precedent, so
Tower and Week cannot drift apart. 7px, matching the library's unread dot; the lit dot keeps
its calendar colour and adds that dot's glow.

WeekView caps a lane at 5 and shows `+n`. Muting there is per **day**, not per event: a day
that is over recedes whole.

**Not built, deliberately:** no event detail, no tap-through, no re-styling of the day cards
beyond the lane the plan asked for.
