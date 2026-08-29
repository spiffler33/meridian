# Meridian

A single-user personal cockpit: an iPhone home-screen PWA and a laptop browser tab, for one person. React 19 · TypeScript · Vite 5 · Tailwind 3. No backend, no accounts, no server.

## Data

IndexedDB is the working copy — first paint reads it and never awaits the network. The durable store is an append-only JSONL journal in the private repo `spiffler33/meridian-data`: one event per line, never compacted. The app folds those events into state with field-level last-writer-wins, so two devices editing different fields of one record both survive; `CLAUDE.md` is the normative spec for the event shape, the fold order, and the sync rules.

Backup needs a fine-grained GitHub PAT (that one repo, Contents: read and write), entered in Settings. It lives only in IndexedDB — never in source, a bundle, or a commit.

## Surfaces

The rail is **tower** · **pulse** · **habits** · **year** · **read**. Settings opens from the mark in the top-left corner.

| key | goes to |
|---|---|
| `t` `p` `h` `y` `r` | tower · pulse · habits · year · read |
| `s` | settings |
| `w` | the week lens, opened over the year |
| `0` | today |
| `←` `→` | previous / next day |

Shortcuts stay off while typing in an input, a textarea, or a contenteditable.

## Commands

```bash
npm run dev       # vite dev server
npm run build     # tsc -b && vite build
npm test          # vitest, watching; `npm test -- --run` for a single pass
npm run lint      # eslint
npm run preview   # serve the built dist/
```

## Deploy

Push `main`. `.github/workflows/deploy.yml` builds and publishes to GitHub Pages, live at **meridian.spiffler.xyz** — a custom domain, so `vite.config.ts` sets `base: '/'`.

## More

- `CLAUDE.md` — how the journal, the fold, sync, and the hard fences actually work. Authoritative.
- `docs/DESIGN_PRINCIPLES.md` — the visual and interaction language.
- `docs/archive/` — closed plans, kept for history. Nothing there describes current behaviour.
