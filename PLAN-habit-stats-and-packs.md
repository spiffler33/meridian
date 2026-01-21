# Habit Stats & Packs

> Simple is better than complex.
> Flat is better than nested.
> Sparse is better than dense.

---

## Status

**Phase 1: COMPLETE** (merged to main)
- `src/utils/habitStats.ts` - pure calculation functions
- `src/components/HabitStatsPopover.tsx` - popover UI
- `src/components/HabitGrid.tsx` - split click targets (dot toggles, label opens stats)
- `src/services/data.ts` - added `getHabitCompletionDates()`
- `src/views/HabitsView.tsx` - popover state and data fetching

**Phase 2: COMPLETE**
- `supabase/migrations/20260121_create_packs.sql` - database tables
- `src/types/database.ts` - Pack and PackSession database types
- `src/types/index.ts` - Pack, PackSession, PackWithCount domain types
- `src/services/data.ts` - CRUD for packs and pack_sessions
- `src/store/AppContext.tsx` - packs state and methods
- `src/components/PacksSection.tsx` - main packs UI with progress bars
- `src/components/PackLogModal.tsx` - log a session
- `src/components/PackHistoryModal.tsx` - view session history
- `src/components/PackCreateModal.tsx` - create new pack
- `src/views/HabitsView.tsx` - integrated PacksSection

---

## The Ask

1. **See streaks in context** — "15 days no alcohol *this month*"
2. **Track finite sessions** — "12/48 trainer sessions used"
3. **Add notes to sessions** — "Deadlift PR 80kg"

---

## Phase 1: Habit Stats Popover

Click a habit → see depth without leaving the flow.

```
┌─────────────────────────────┐
│  NO ALCOHOL                 │
│                             │
│  streak          15d        │
│  longest         23d        │
│                             │
│  this week       5/7   71%  │
│  this month     15/21  71%  │
│  this year      45/52  87%  │
│                             │
│  jan ●●●●●○●●●●●●●●●       │
└─────────────────────────────┘
```

**Files touched:**
- `src/components/HabitGrid.tsx` — add click handler, popover trigger
- `src/components/HabitStatsPopover.tsx` — new component
- `src/utils/habitStats.ts` — period calculations

**Data:** None new. Calculate from existing `habit_completions`.

**Logic:**
```
thisWeek   = completions where date in [monday..sunday]
thisMonth  = completions where date in [1st..today]
thisYear   = completions where date in [jan1..today]
```

---

## Phase 2: Session Packs

A new primitive: finite counters with optional notes.

```
PACKS

trainer sessions    ████████░░░░  12/48   [+]
spanish lessons     ██████████░░  20/30   [+]
```

**New table: `packs`**
```sql
id
user_id
label
total        -- 48
created_at
archived_at
```

**New table: `pack_sessions`**
```sql
id
pack_id
date
note         -- optional, nullable
created_at
```

**Files touched:**
- `src/types/index.ts` — Pack, PackSession types
- `src/services/data.ts` — CRUD for packs
- `src/store/AppContext.tsx` — packs state
- `src/components/PacksSection.tsx` — new component
- `src/components/PackLogModal.tsx` — log a session
- `src/components/PackHistoryModal.tsx` — view history
- `src/views/HabitsView.tsx` — add PacksSection

---

## Guiding Constraints

- No new nav items
- No new views
- Packs live in Habits view
- Stats appear on demand (popover)
- Mobile-first touch targets
- Keyboard accessible
- Same visual language: `●` `○` `████░░░░`

---

## Order of Operations

```
1. habitStats.ts        — pure functions, testable
2. HabitStatsPopover    — wire to HabitGrid
3. packs migration      — supabase schema
4. data.ts packs CRUD   — service layer
5. PacksSection         — UI component
6. PackLogModal         — inline or modal
7. PackHistoryModal     — click to expand
```

---

## Not Doing

- Habit-specific notes (use Thoughts for daily reflection)
- Pack reminders/notifications
- Pack sharing
- Habit categories/folders
- Complex pack scheduling

---

*One thing at a time. Ship Phase 1, feel it, then Phase 2.*
