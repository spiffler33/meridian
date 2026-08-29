Closed plans and superseded documents, kept for history only. **Nothing here describes how Meridian currently behaves** — `CLAUDE.md` at the repo root is authoritative, and where the two disagree the archive is simply out of date.

- `kill_supabase_plan.md` — the local-first rework brief. Every build phase shipped and Supabase was removed entirely in 2026-08; only its final hands-on acceptance drill is left unticked.
- `PLAN-habit-stats-and-packs.md` — habit stats popover and packs, both phases complete. Its file list still names `supabase/migrations/` and `src/types/database.ts`, neither of which exists any more.
- `DEPLOYMENT_CHECKLIST.md` — a generic spiffler.xyz deploy checklist built around `VITE_SUPABASE_*` secrets; the app uses no `VITE_` env vars at all now.
- `PLAN_READING_PANE.md` — the `read` view, complete 2026-08-26, all phases shipped. A few `src/` comments still cite it by its old `docs/` path.
- `reading-pane-mockup.html` — the static mockup that plan was drawn against, superseded by the shipped `ReadView`.
- `PLAN_TOWER.md` — the original Tower design. Its Postgres schema is superseded by the journal's `towerItem` entity, and its Phase 5 "Social" was never built.
- `PLAN_PULSE_PHASES_4_5.md` — an addendum whose phases and hard fence 9 were pasted into `calendar/PLAN_PULSE.md`, which is the live copy.
- `business_plan/` — January 2026 research pitching a React Native "Tower" spinoff on Supabase Pro with a paid subscription. Never acted on, and contradicted by the Supabase removal.
