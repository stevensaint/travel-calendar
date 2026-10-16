# Elsewhere - event-driven travel calendar

A month-by-month calendar of the best events in the world to travel for, with a
12-day cost estimate per trip, matched against your Going.com flight deals.

**Stack:** Google Apps Script (backend) + Google Sheet (database) + GitHub Pages (site).

## Files

| File | Where it goes |
|---|---|
| `index.html` | GitHub repo (the calendar - the main page) |
| `globe.html` | GitHub repo, same folder (linked from the footer) |
| `events.json` | GitHub repo. **Written automatically** by Apps Script every week - never edit by hand |
| `Code.gs` | Apps Script ONLY. **Never put it in the GitHub repo.** |

## How it works

```
Sunday 00:00 UTC   weeklyCalendarRefresh
                   -> Claude generates the next 13 months of events (in parallel batches)
                   -> validated, de-duplicated, then written to the Calendar tab
                   -> publishes events.json to the GitHub repo (this is what the website reads)
                   -> if anything fails: your old calendar stays, and you get an email

Daily 8am Pacific  dailyDealCheck
                   -> reads new Going.com emails (each one analysed once, never twice)
                   -> matches deals to events (same place AND dates must line up)
                   -> logs to the Deals tab, emails you only for strong matches
                   -> if the calendar is ever >9 days old it restarts a refresh itself
```

## Setup

1. **API key (important):** Apps Script -> Project Settings (gear) -> Script Properties
   -> Add script property: `ANTHROPIC_API_KEY` = your key. Do not paste it into code.
   If an earlier version of Code.gs was ever in your GitHub repo, delete it there and
   revoke/rotate that key at console.anthropic.com (git history keeps old versions).
2. Paste the new `Code.gs` over the old one and save.
3. Run `setupTriggers` once (approve permissions). This replaces any old triggers.
4. Run `weeklyCalendarRefresh` once to fill the calendar. It takes a few minutes and
   continues on its own across runs if needed - watch progress with `checkStatus`.
5. **Website updates:** create a GitHub fine-grained token (GitHub -> Settings -> Developer settings -> Personal access tokens -> Fine-grained). Repository access: only `travel-calendar`. Permission: Contents = Read and write. Add it in Script Properties as `GITHUB_TOKEN`. Run `publishSnapshot` once to create `events.json`. Tokens expire (max 1 year) - if one does, you get a "website update failed" email; make a new token and replace the property.
6. Upload `index.html` and `globe.html` to the repo root. The site updates in ~1 minute.
7. The website no longer reads the Sheet, so keep the Sheet **Restricted** (private). Deals and Gmail links never leave your account.

## Handy functions

| Function | What it does |
|---|---|
| `checkStatus` | Last refresh time, run state, API key present?, active triggers |
| `weeklyCalendarRefresh` | Force a refresh now (also republishes the website data) |
| `publishSnapshot` | Republish events.json from the Calendar tab now (no Claude cost) |
| `testDealMatch` | Try the matcher on a sample email |
| `debugGmail` | Show what the Gmail search sees |

## Settings (top of Code.gs)

- `REFRESH_WEEKDAY` / `REFRESH_HOUR_UTC` - default Sunday 00:00 UTC. Change to `'MONDAY'` (00:00 UTC) if you meant the Sunday-to-Monday boundary, then run `setupTriggers` again.
- `LOOKBACK_DAYS`, `EVENTS_PER_MONTH`, `MONTHS_AHEAD`, `MODEL`.

Cost estimates are informational only and never affect which events are shown or ranked.

## Sheet layout

- **Calendar**: id, startDate, endDate, destination, country, lat, lon, region, event,
  eventDates, datesApprox, hook, overview, bookAhead, tags, flightCost, housingCost,
  foodCost, experientialCost, totalCost, costNotes, alternates
- **Deals**: date, threadId, subject, destination, country, price, travelWindow,
  matchFound, matchScore, calendarEventId, calendarEvent, calendarTiming, matchDetails,
  bookAhead, permalink
- **Meta / Staging**: bookkeeping (refresh state, in-progress months)

The first refresh with the new script rewrites the Calendar and Deals tabs in place
(same tab IDs, so the site keeps working). Old deal rows are cleared.
