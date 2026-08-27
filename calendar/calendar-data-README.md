# calendar-data

Private mirror of Google Calendar feeds into committed JSON, read by meridian at runtime.
The app never writes here; a scheduled GitHub Action is the only writer.

## Layout

```
.github/workflows/mirror.yml   ← the schedule (file provided as mirror.yml — place it here)
scripts/mirror.py              ← fetch + normalize (file provided as mirror.py — place it here)
events.json                    ← output, written by the Action only
meta/heartbeat                 ← keep-alive marker, written by the Action only
```

## Setup

1. Create this repo **private**. Default branch `main`.
2. Add the two files at the paths above. Commit.
3. Google Calendar → Settings → (each calendar) → **Secret address in iCal format** → copy.
4. Repo → Settings → Secrets and variables → Actions → add:
   - `ICS_HOME`
   - `ICS_PERSONAL`
   - `ICS_DB`   (the shadow calendar — titles stay "DB call / meeting")
5. Actions tab → `mirror` → **Run workflow**. Confirm `events.json` lands and looks right.
6. Extend the meridian read-only fine-grained PAT to also select this repo (same Contents:read grant).

Adding a calendar later = one new `ICS_<NAME>` secret **plus** one matching env line in
`mirror.yml` (Actions cannot enumerate secrets dynamically).

## Security

- Secret ICS URLs are **capability URLs** — possession = read access to that calendar.
  They exist only as Actions secrets. Never commit them, never echo them; the script
  reports feed failures by calendar name only, never by URL.
- If a URL leaks: Google Calendar settings → **Reset** the secret address, update the secret here.
- `PRIVATE_CALS` (env in `mirror.yml`, e.g. `db`): listed calendars get every event title
  replaced by the calendar name at mirror time. Defense-in-depth for the work calendar —
  source discipline first, this switch second.

## Behaviour

- Schedule: every 30 min, 06:00–00:30 SGT (cron is UTC in the workflow). Free-tier cron
  drifts by minutes; irrelevant for a planning mirror.
- Window: 7 days back, 60 days forward, recurrences expanded.
- **Commits only when event content changes** — so meridian's head-sha check stays one
  cheap API call. A heartbeat commit lands if nothing changed for 21 days, which keeps
  GitHub from auto-disabling the schedule for inactivity.
- Any feed failure ⇒ the run fails **without writing** — stale-but-complete beats
  silently missing a calendar. The failed run shows red in the Actions tab.

## events.json schema (what meridian parses)

```json
{
  "generated_at": "2026-08-26T04:00:00Z",
  "content_hash": "…",
  "window": { "start": "2026-08-19", "end": "2026-10-25" },
  "calendars": ["db", "home", "personal"],
  "events": [
    {
      "id": "16-hex",
      "calendar": "home",
      "title": "…",
      "start": "2026-08-26T09:30:00Z",   // UTC; all-day events use date-only strings
      "end":   "2026-08-26T10:00:00Z",   // all-day end is EXCLUSIVE (RFC 5545)
      "allDay": false,
      "location": "…"                     // optional
    }
  ]
}
```

Times are UTC ISO; the app renders in device timezone. All-day events carry date strings
and an exclusive end date. Events are sorted by start; all-day items sort first within a day.
