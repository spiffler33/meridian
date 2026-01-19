# Design Principles

## Core Philosophy

**Terminal Meets Journal**
A productivity tool that feels like a well-worn terminal, not a corporate app. Clean typography, purposeful density, and respect for the user's intelligence.

**Steer Attention, Don't Manage Tasks**
Traditional todo apps treat tasks as atomic, binary objects. We treat attention as the scarce resource. Surface what matters now, hide the rest accountably. The system remembers so the brain can let go.

---

## Visual Language

### Typography
- Monospace fonts throughout (JetBrains Mono, Monaco, Menlo)
- Text is the interface
- Information density over whitespace
- Let content breathe through line height, not padding

### Color Philosophy
- Dark-first design (high contrast, low eye strain)
- Muted accent colors that don't compete with content
- Borders as subtle dividers, not decorations
- No gradients, no shadows (unless functional)

### Shape Language
- Smooth edges with subtle border-radius (4-8px)
- No sharp corners, no pills
- Rectangular, grid-aligned layouts
- Consistent spacing rhythm (multiples of 4px)

### Icons and Decoration
- **NO emojis** anywhere in the interface
- ASCII characters and Unicode symbols only (checkmarks, arrows, pipes)
- Functional iconography only
- No illustrations, mascots, or decorative elements

---

## Interaction Design

### Input Philosophy
- Direct manipulation over modal dialogs
- Inline editing everywhere possible
- Keyboard-first, mouse-supported (touch-first on mobile)
- Immediate feedback, no loading spinners where avoidable
- Log-first capture: natural language in, structure derived by AI
- Zero friction capture beats perfect categorization

### Feedback Style
- Subtle state changes (opacity, underline, color shift)
- No bouncing, shaking, or attention-grabbing animations
- Transitions should be fast (100-200ms) or instant
- Error states as inline text, not toast notifications

### Navigation
- Keyboard shortcuts for all primary actions
- URL-based state (shareable, bookmarkable)
- Minimal clicks to reach any view
- No nested menus or dropdowns where avoidable

### Fog of War
- Show only what's actionable now (1-3 items)
- Hide everything else, but accountably (follow up, someday)
- Hidden items have reasons ("waiting on dad", "blocked until Tuesday")
- Blocked is a stable state, not a failure
- Actions surface before events (actionable NOW beats time-bound reminders)
- isEvent distinguishes "things you DO" from "things you SHOW UP to"

---

## Tone of Voice

### UI Copy
- Terse, imperative labels ("Save", not "Save changes")
- No exclamation marks or artificial excitement
- Questions are direct ("Delete this?" not "Are you sure you want to delete this item?")
- Error messages explain what happened, not apologize

### AI Assistant Personality
- **Default**: Stoic, Naval Ravikant-inspired coach
- Focuses on: leverage, compound effects, what matters most
- 2-3 sentences maximum
- No platitudes or generic encouragement
- **Personalization available**: Can be friendlier based on user preference
- Acknowledges user's personal context (health goals, struggles)
- Supportive without being saccharine

---

## Content Philosophy

### What We Track
- Tower items (stateful: active, waiting, someday, done)
- Expectations ("expects by") — not due dates, psychologically different
- Waiting states (who/what is blocking progress)
- Item type (isEvent) — actions vs events have different surfacing logic
- Thoughts (unstructured) vs Tower items (committed actions)
- Habits (binary completions, streaks matter)
- Reflections (end-of-day thoughts)

### What We Don't Track
- Time spent (not a time tracker)
- Priorities or tags (surfacing logic handles importance)
- Goals beyond "done/not done"
- Anything that adds friction without adding insight

### Data Ownership
- User owns their data completely
- Export always available (JSON)
- No lock-in, no proprietary formats
- Local-first, sync-optional

---

## Technical Constraints

### Dependencies
- Minimal external libraries
- No date libraries (native Date is sufficient)
- No state management libraries (Context + useReducer)
- No CSS-in-JS (Tailwind for utility, CSS custom properties for theming)

### Performance
- Fast initial load (no framework overhead)
- Instant interactions (optimistic updates)
- Pre-compute analytics before API calls
- Lazy load non-critical features

### Accessibility
- Semantic HTML
- Keyboard navigable
- Sufficient color contrast
- Screen reader compatible

---

## Anti-Patterns (What We Avoid)

- Gamification (no points, badges, leaderboards)
- Social comparison (friends for body doubling and accountability, not competition)
- Notification spam (user initiates, not app)
- Dark patterns (no guilt, no streaks as punishment)
- Feature creep (every addition must justify cognitive cost)
- Modal dialogs (prefer inline actions)
- Loading states (prefer optimistic updates)
- Onboarding tutorials (interface should be self-evident)

---

## Theme Palette

Five themes maintaining the core aesthetic:

1. **Dark** (default) - Modern terminal, green accents
2. **Matrix** - Hacker aesthetic, high contrast green
3. **Paper** - Warm, literary, sepia tones
4. **Midnight** - Deep blue, calming
5. **Mono** - Pure black/white, maximum contrast

All themes share:
- Same typography scale
- Same spacing rhythm
- Same component shapes
- Different color palettes only

---

## Summary

This is a tool for serious personal work. It respects the user's time and attention by being fast, focused, and free of distraction. Every element earns its place through utility, not decoration.

*"Simplicity is the ultimate sophistication."*
