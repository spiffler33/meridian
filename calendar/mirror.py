#!/usr/bin/env python3
"""Place at: scripts/mirror.py

Mirror Google Calendar secret ICS feeds into events.json.

Env:
  ICS_<NAME>     one per calendar (ICS_HOME, ICS_PERSONAL, ICS_DB, ...)
  PRIVATE_CALS   optional, comma-separated calendar names whose event titles
                 are replaced by the calendar name (defense-in-depth)

Contract:
  - Window: 7 days back .. 60 days forward (Asia/Singapore), recurrences expanded.
  - Times: UTC ISO for timed events; date-only strings for all-day
    (all-day end is EXCLUSIVE per RFC 5545).
  - Writes events.json ONLY when event content changes (content_hash),
    so downstream head-sha checks stay cheap.
  - ANY feed failure => exit 1 WITHOUT writing (stale-but-complete beats partial).
  - Never prints or logs a feed URL. Failures are reported by calendar name only.
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests
import recurring_ical_events
from icalendar import Calendar

TZ = ZoneInfo("Asia/Singapore")
WINDOW_BACK_DAYS = 7
WINDOW_FWD_DAYS = 60
OUT = "events.json"


def iso(dt):
    """UTC ISO for datetimes; plain ISO date for all-day date objects."""
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return dt.isoformat()


def fetch(name, url, start, end, private):
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    cal = Calendar.from_ical(r.content)
    out = []
    for ev in recurring_ical_events.of(cal).between(start, end):
        if str(ev.get("STATUS", "")).upper() == "CANCELLED":
            continue
        dtstart = ev["DTSTART"].dt
        dtend_prop = ev.get("DTEND")
        dtend = dtend_prop.dt if dtend_prop is not None else dtstart
        all_day = not isinstance(dtstart, datetime)
        uid = str(ev.get("UID", ""))
        title = name if private else str(ev.get("SUMMARY", "(untitled)")).strip()
        loc = str(ev.get("LOCATION", "")).strip() or None
        item = {
            "id": hashlib.sha1(f"{uid}|{iso(dtstart)}".encode()).hexdigest()[:16],
            "calendar": name,
            "title": title or "(untitled)",
            "start": iso(dtstart),
            "end": iso(dtend),
            "allDay": all_day,
        }
        if loc:
            item["location"] = loc
        out.append(item)
    return out


def main():
    cals = {
        k[4:].lower(): v
        for k, v in os.environ.items()
        if k.startswith("ICS_") and v.strip()
    }
    if not cals:
        sys.exit("no ICS_* env vars set")

    private = {
        c.strip().lower()
        for c in os.environ.get("PRIVATE_CALS", "").split(",")
        if c.strip()
    }

    today = datetime.now(TZ).date()
    start = today - timedelta(days=WINDOW_BACK_DAYS)
    end = today + timedelta(days=WINDOW_FWD_DAYS)

    events, errors = [], []
    for name in sorted(cals):
        try:
            events += fetch(name, cals[name], start, end, name in private)
        except Exception as ex:  # never include the URL
            errors.append(f"{name}: {type(ex).__name__}")

    if errors:
        sys.exit("feed failure(s), not writing: " + "; ".join(errors))

    events.sort(key=lambda e: (e["start"], e["calendar"], e["id"]))
    body = {
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "calendars": sorted(cals),
        "events": events,
    }
    digest = hashlib.sha1(
        json.dumps(body, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()

    old = None
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                old = json.load(f).get("content_hash")
        except Exception:
            old = None  # unreadable previous file: rewrite

    if digest == old:
        print("unchanged")
        return

    body["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body["content_hash"] = digest
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(body, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(events)} events from {len(cals)} calendar(s)")


if __name__ == "__main__":
    main()
