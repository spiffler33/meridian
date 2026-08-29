# Tower: Attention Steering for ADHD Brains

> "Steer attention, don't manage tasks."

---

## Philosophy

Traditional todo apps treat tasks as atomic, context-free, binary objects. Human brains don't work that way. Tower is a **control surface for attention** — it surfaces what matters now, hides everything else accountably, and lets you capture thoughts without friction.

**Core loop:**
1. Open → see what needs attention (1-3 items)
2. Act → do it or hold it (with expectation)
3. Capture → natural language, AI structures it
4. Trust → system remembers so you don't have to

---

## Architecture Changes

### Navigation

```
Current:  [Today] [Week] [Year] [Settings]
New:      [Tower] [Habits] [Week] [Year] [Settings]
```

- **Tower** — attention steering (replaces task portion of Today)
- **Habits** — daily habit tracking (the good part of Today)
- Remove "Today's Focus" from top (Tower IS the focus)

### Data Model

New table: `tower_items`

```sql
tower_items (
  id            uuid primary key,
  user_id       uuid references profiles(id),
  text          text not null,           -- raw capture
  status        text default 'active',   -- active | waiting | someday | done
  waiting_on    text,                    -- person or thing blocking
  expects_by    date,                    -- when to resurface
  effort        text,                    -- quick | medium | deep (AI-inferred)
  is_event      boolean default false,   -- false = action (DO it), true = event (SHOW UP)
  last_touched  timestamp,
  created_at    timestamp,
  done_at       timestamp
)
```

Keep existing `tasks` table for legacy/migration. Tower items are not date-bound.

---

## UI Components

### TowerView.tsx

```
┌─────────────────────────────────────┐
│ TOWER                               │
│─────────────────────────────────────│
│ NOW                                 │
│ > Reply to Gordon                   │
│   asked 2d ago · quick              │
│   [ 2 min ]  [done]  [hold]         │
│─────────────────────────────────────│
│   Draft slide feedback              │
│   Call bank re: wire                │
│   [+3 more]                         │
│─────────────────────────────────────│
│ [+] FOLLOW UP (3) ·················│
│─────────────────────────────────────│
│ [+] SOMEDAY (12)                    │
│─────────────────────────────────────│
│ _ what needs doing?                 │
└─────────────────────────────────────┘
```

**Components:**
- `NowCard` — hero item with `>` prefix, 2-min button
- `QueueList` — next 2 items (de-emphasized)
- `[+X more]` — expandable overflow for remaining active items
- `FollowUpSection` — blocked items with expects_by (collapsed)
- `SomedaySection` — low priority items (collapsed)
- `CaptureInput` — bottom, always visible, "what needs doing?"

### HabitsView.tsx

Extract from TodayView:
- HabitGrid (existing)
- Date navigation
- Reflection (maybe move to Tower end-of-day?)

### Interactions

**Hold flow (inline, no modal):**
```
> Reply to Gordon
  why? [waiting on him] [need info] [other]
  check back? [tomorrow] [tue] [fri] [no date]
  [ confirm ]
```

**Completion:** just "done." — next item slides up

---

## AI Capture

User types: `call bank about wire transfer, also dentist friday`

AI returns:
```json
{
  "items": [
    {
      "text": "call bank about wire transfer",
      "status": "active",
      "isEvent": false,
      "effort": "quick"
    },
    {
      "text": "dentist",
      "status": "active",
      "isEvent": true,
      "expectsBy": "2026-01-24",
      "effort": "medium"
    }
  ]
}
```

### Classification Rules for isEvent

**Event signals (isEvent: true):**
- Nouns: appointment, meeting, dentist, doctor, flight, dinner, birthday, concert, interview, wedding, surgery, jury duty
- Patterns: "X at 3pm", "X on monday" (noun + time, no action verb)

**Action signals (isEvent: false):**
- Verbs: call, email, send, buy, prepare, submit, pay, cancel, renew, fix, write, draft, review, book
- Keywords: "by", "before", "due", "until", "deadline"

**Primary verb rule:** When both present, the verb determines:
- "prepare for meeting monday" → prepare (action) → isEvent: false
- "meeting monday" → meeting (event) → isEvent: true

Show parsed result, user confirms or edits.

---

## Surfacing Logic

Items surface based on TWO key factors:
1. **isEvent** - Is this an action you DO, or an event you SHOW UP to?
2. **Date role** - Is the date a deadline (do before) or reminder (do on)?

### The Model

| isEvent | Has Date | Interpretation | Surface Behavior |
|---------|----------|----------------|------------------|
| false   | no       | Pure action    | NOW by staleness |
| false   | yes      | Deadline       | Urgency increases |
| true    | yes      | Event/reminder | Day-before + day-of |

### Priority Order (top surfaces first)

1. **Overdue actions** - past deadline, MUST do
2. **Actions due today** - deadline is today
3. **Stale actions** - no date, sorted by last_touched (oldest first)
4. **Events TODAY** - show as time-bound reminders
5. **Actions due within 3 days** - approaching deadlines
6. **Events tomorrow** - advance notice
7. **Actions 4-7 days out** - queue visibility
8. **Hidden** - events >1 day away, actions >7 days, someday items

### Key Insight

Stale actions beat same-day events for hero position because:
- Events are time-bound (you can't "do" dentist until appointment time)
- Actions are immediately actionable
- Events show as reminders, but hero is what you can act on NOW

---

## Friends / Body Doubling

Already have `friendships` table. Add to habits first:

**HabitsView additions:**
- Show friend's habit completion status (anonymized or full based on setting)
- "X completed 6/8 habits today" — social proof
- Optional: "working on habits together" real-time indicator

**Future:** extend to Tower items (shared accountability)

---

## Thoughts vs Tower

Two distinct capture points with different commitment levels:

| Aspect | Thoughts (Habits tab) | Tower |
|--------|----------------------|-------|
| Location | Below habit grid | Tower tab |
| Commitment | None - brain dump | Implicit contract to act |
| Structure | Unstructured text | Parsed into items |
| AI role | Finds patterns, may suggest → Tower | Parses into structured items |
| Placeholder | "what's on your mind?" | "_" |

### The Graduation Path

1. User writes in Thoughts: "I miss playing guitar"
2. AI stores, notices pattern over weeks
3. Daily insight: "You've mentioned guitar 3x. Add to Tower?"
4. User confirms → Tower [someday]: "explore guitar lessons"
5. User activates → Tower [active]: "research guitar teachers"

This keeps Tower clean (committed items only) while capturing wishes/thoughts.

---

## Implementation Order

### Phase 1: Foundation [COMPLETE]
1. ~~Create `tower_items` table in Supabase~~
2. ~~Add Tower route and basic TowerView~~
3. ~~Split TodayView → HabitsView (keep habits, reflection)~~
4. ~~Update navigation tabs~~

### Phase 2: Core Tower [COMPLETE]
5. ~~NowCard with 2-min timer (reuse TwoMinuteTimer)~~
6. ~~QueueList showing next 2-3 items~~
7. ~~WaitingRoom with expects_by display~~
8. ~~Someday collapse/expand~~
9. ~~CaptureInput (text only first, no AI)~~

### Phase 3: Intelligence [COMPLETE]
10. ~~AI capture parsing (Claude API)~~
11. ~~"Why this?" explainer~~ (removed - trust the algorithm)
12. ~~Surfacing logic refinement (isEvent model)~~

### Phase 4: Polish [SKIPPED]
*ADHD brains feel relief, not accomplishment. "Done" is enough.*
~~13. Hold flow (inline)~~
~~14. Completion animation~~
~~15. End-of-day summary~~

### Phase 5: Social
16. Friends habit visibility
17. Body doubling indicator

---

## Design Principles Update

Add to DESIGN_PRINCIPLES.md:

```markdown
### What We Track (updated)
- Tower items (stateful, not date-bound)
- Expectations ("expects by") — not due dates, psychologically different
- Waiting states (who/what is blocking)
```

Remove:
- "no due dates, priorities, tags" — we now track expectations

---

## Mobile Considerations

- Touch-first interactions
- Bottom capture input (thumb-reachable)
- Swipe gestures (future): right = do, left = hold
- One-handed operation priority
- Keep terminal aesthetic (monospace, dense)

---

## Success Criteria

Tower works when:
- Opening the app feels calming, not overwhelming
- You trust the system to surface the right thing
- Blocked items don't haunt you
- Capture is faster than any other app
- You stop keeping lists in your head
