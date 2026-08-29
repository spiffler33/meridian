# Design Principles

This document is the source of truth for all aesthetic decisions. Read it before any frontend work.

The tokens live in `src/index.css` and are exposed to Tailwind by `tailwind.config.js`. Those two
files implement what is written here; if they disagree with this document, one of them is wrong.

---

## What this is

A single-user cockpit its owner opens to log a thought, mark a win, sit with a feeling, and read.

That sentence decides everything below. The app is not competing for attention — it already has it.
It has one job when opened and one obligation always: **never be the reason the day gets worse.**
So it does not celebrate, nag, badge, congratulate, spin, or bounce. It shows what is true and gets
out of the way.

**Archetype: warm journal, terminal instrument.** The paper is warm and the voice is quiet, the way
a notebook is; the readouts are monospace and dense, the way an instrument is. Those are the only
two registers. Anything that is neither is decoration and does not ship.

**Quality comes from restraint, consistency, proportion and detail — never from ornament.** When a
choice is ambiguous, choose *less*.

---

## The named enemy

Most generated interfaces in 2026 collapse to the same look: violet and slate, drop shadows to
"make it pop", gradient blobs, pill buttons, emoji in headings, rounded cards floating on grey.
**If a choice looks like the default an LLM would emit, that is a reason to reject it.**

Concretely banned here: purple/violet/indigo/slate/fuchsia/pink in any form; `shadow-*` and
`drop-shadow` on anything (a hairline border does the dividing); `rounded-full` except on a dot
that is genuinely a dot; gradients; emoji anywhere in the interface, including empty states and
error copy; illustrations, mascots and empty-state art.

---

## Colour

**One design in two lightnesses.** Night is home turf; day is real parity, designed rather than
inverted. There is no third theme, and there will not be — five palettes was five designs wearing
one layout, and none of them could be kept coherent.

All tokens are **OKLCH**, in one warm hue family (~58–85). Day and night differ by lightness, not
by a re-pick, which is what keeps them the same design. Never add a hex or HSL theme colour.

**Colour is earned. Every colour answers "what state, what action, what kind of thing".** There are
exactly four hues in the whole app beyond the neutrals:

| Token | Job |
|---|---|
| `accent` | the current thing, the live thing, the active tab, the thing you are on |
| `error` | something needs the owner — and nothing else, ever |
| `settled` | the setpoint instrument's settled state. Nowhere else. |
| `cite` | a citation mark and where it lands. Nowhere else. |

Neutrals, in order of loudness:

`bg` · `bg-card` · `bg-hover` · `border` · `border-focus` · `text` · `text-secondary` ·
`text-muted` · `text-faint`

Four text tiers, and they mean things: `text` is content; `text-secondary` is supporting;
`text-muted` is metadata (timestamps, counts, status); `text-faint` is the **whisper tier** — it
sits below the contrast bar on purpose, and **nothing load-bearing may be written in it.**

Contrast is measured, not estimated. Both themes pass WCAG AA simultaneously: text 15.1:1 / 14.5:1,
secondary 7.9 / 6.8, muted 4.6 / 4.8, accent 9.7 / 5.6, error 6.0 / 6.4.

**No `/opacity` on theme tokens.** A token holds a whole colour, not channels, so `bg-accent/5`
compiles to nothing at all — it was silently doing nothing for months. Where a tint is genuinely
wanted, `index.css` mixes a named one (`accent-wash`, `accent-rim`, `cite-rim`) and it is used by
name.

---

## Typography

**Type is the interface.** A word before a glyph, always. Density comes from line-height, not
padding — this is the single most-violated rule; hold it.

**Two faces, and only two:**

- **`font-mono` — the instrument.** Anything *the app says*: nav, labels, numbers, counts, statuses,
  buttons, timestamps, empty states, settings. It is the default on `<html>`; you rarely write it.
- **`font-read` — the voice.** Anything *the owner wrote or is reading*: pulse lines, thoughts,
  reflections, tower item text, the year theme, personal context, briefs, essays, prose.

There is no sans-serif in this app. If a third face seems necessary, the answer is a different size
or weight of one of these two.

**One scale, five steps, obeyed everywhere.** Never write an arbitrary size (`text-[13.5px]`);
if none of these fits, the design is wrong, not the scale.

| Class | Size | For |
|---|---|---|
| `text-2xs` | 10px | micro instrument — heat cells, timing strips, chip labels |
| `text-xs` | 11px | labels, captions, the footer |
| `text-sm` | 14px | **the UI default** — nav, buttons, rows, most of the app |
| `text-base` | 16px | reading — pulse lines, prose, anything in `font-read` |
| `text-lg` | 20px | display — the date, a page's one big number |

`tabular-nums` wherever numbers align in a column or tick over in place. Body measure caps at
~70ch (`.prose-read` already does).

---

## Shape, space, motion

- Border radius is `rounded` (6px) or nothing. No sharp 0px, no pills, no `rounded-xl`+.
- **Hairlines divide, not background blocks and never shadows.** `border-border` at 1px.
- **Frames do not nest.** A bordered control inside a bordered card inside a bordered section is
  three frames saying one thing. Prefer a section rule and a label to a box.
- 4px spacing rhythm — every margin, padding and gap a multiple of 4.
- Motion is 100–200ms or absent, and only opacity/colour/border. Never `transition-all`. No spin,
  bounce, shake, scale. The two exceptions are instruments, not controls, and are documented where
  they live: the setpoint wave (0.8s) and the citation landing (1.8s).
- Focus is always visible. `focus:outline-none` is only permitted when a replacement is on the same
  element or its documented parent.

---

## Voice

Terse, lowercase, stoic. Imperative labels ("save", not "save changes"). **No exclamation marks —
they signal desperation.** No congratulation, no apology, no "oops". Errors state what happened and
what to do. When the information is sufficient, silence beats commentary.

**An empty state is a sentence, not a box.** One muted line in the app's own lowercase register.
Never a dashed frame, never centred hero text, never an illustration, never an instruction the
interface should have made unnecessary.

**Zero is not a fact — it is the absence of one.** A tally of nothing does not render.

**A surface read in passing carries one number; provenance belongs where the reviewing happens.**
The owner glances at the capture page thirty times a day and studies Energy once a week, and those
are different jobs. A readout that answers "how much of this rests on a guess" beside a readout that
answers "how much" makes neither legible at a glance — measured on the nutrition line, which printed
five figures until the owner had lived with it for a day: *"a nightmare for an ADHD brain"*. Move the
breakdown to the surface where it is actually asked for; do not shrink it, colour it, or hide it
behind a tap. Where dropping a part outright would make the remaining number **lie** — a total that
omits food nobody could size — carry that fact as a mark on the number itself (`980+ kcal`), never as
a second figure.

---

## Never

Gamification (points, badges, leaderboards, streaks-as-punishment). Social comparison. Notification
spam. Dark patterns — guilt, manufactured urgency, countdowns that push. Modal dialogs where inline
works. Loading spinners where an optimistic update works. Onboarding tutorials — fix the interface
instead. Skeuomorphic paper or leather textures; warmth is evoked by restraint, not simulated.

**Delight comes from what is surfaced, not from chrome.** Novelty lives in the content — the
day's quote, what the ledger noticed, what is owed — never in visual ornament.

---

## Foundation

Semantic HTML. Keyboard-navigable, with a visible focus ring. WCAG AA in both themes, measured.
CSS custom properties for theming; no CSS-in-JS; inline `style` only for genuinely dynamic values
(a computed bar width), never for a static constant.

Minimal dependencies — the app ships React and nothing else. No web fonts, no icon library, no CDN.
Iconography is ASCII/Unicode only: `→ ← ↑ ↓ · • ✓ ✗ … │ ─ ‹ › ◐ §`.

---

## The test

Before calling a component done:

> **Would Aston Martin ship this? Would Hermès? Would Dieter Rams?**

If no, it gets redone.

*"Simplicity is the ultimate sophistication."* — Leonardo da Vinci
