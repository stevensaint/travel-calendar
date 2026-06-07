# Travel Calendar

A personal travel calendar that surfaces the best destinations week-by-week,
and lights up when a Going.com flight deal matches a calendar event.

**Stack:** Google Apps Script (backend) + Google Sheets (database) + GitHub Pages (frontend)
**Cost:** ~$0/month (Anthropic API calls cost fractions of a cent daily)

---

## How it works

```
Going.com emails → Gmail label
        ↓
Google Apps Script (runs daily at 8am)
  → fetches emails from label
  → asks Claude to match each deal to the event calendar
  → logs all deals to Google Sheet
  → emails you strong matches only
        ↓
Google Sheet (free database)
  → Calendar tab: week-by-week event data (refreshed weekly by Claude)
  → Deals tab: all matched deals log
  → Meta tab: timestamps
        ↓
GitHub Pages (index.html)
  → reads Sheet via public JSON endpoint
  → shows calendar + highlights active deals
```

---

## Setup (one-time, ~15 minutes)

### 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → New spreadsheet
2. Name it **Travel Calendar**
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
4. Go to **File → Share → Publish to web**
   - Publish the entire document as a web page
   - This enables the public JSON endpoint the website reads from

### 2. Create the Google Apps Script

1. Go to [script.google.com](https://script.google.com) → New project
2. Name it **Travel Calendar**
3. Delete the default `myFunction` code
4. Paste the contents of `Code.gs` from this repo
5. Fill in the `CONFIG` block at the top:
   ```javascript
   ANTHROPIC_API_KEY: 'sk-ant-...',   // from console.anthropic.com
   YOUR_EMAIL:        'you@gmail.com',
   SHEET_ID:          '1BxiM...',      // from step 1
   ```
   The `GOING_LABEL` is already set to your confirmed label ID.

### 3. Bootstrap the calendar

1. In Apps Script, select `bootstrapCalendar` from the function dropdown
2. Click **Run**
3. Approve the Gmail + Sheets permissions when prompted
4. Wait ~30 seconds — Claude will generate the full year calendar and write it to your Sheet
5. Open your Sheet and confirm the **Calendar** tab has data

### 4. Set up the triggers

In Apps Script, click the **clock icon** (Triggers) → Add Trigger:

| Function | Event source | Type | Time |
|---|---|---|---|
| `dailyDealCheck` | Time-driven | Day timer | 8am–9am |
| `weeklyCalendarRefresh` | Time-driven | Week timer | Every Sunday, 11pm–12am |

### 5. Deploy the website

1. Fork or clone this repo to your GitHub account
2. Open `index.html` and replace `YOUR_GOOGLE_SHEET_ID` with your actual Sheet ID
3. Go to repo **Settings → Pages → Source → main branch → / (root)**
4. Your site will be live at `https://yourusername.github.io/travel-calendar`
5. Copy that URL and paste it into the `sendDealDigest` function in `Code.gs`
   (the "View full calendar →" link in the email)

### 6. Test everything

Run these functions manually in Apps Script to verify:

```
testSheetConnection  → confirms Sheet ID is correct
bootstrapCalendar    → regenerates calendar from scratch
testDealMatch        → runs a sample email through Claude matching
dailyDealCheck       → full run: fetches emails, matches, logs, emails if matches found
```

---

## Customization

### Calendar content
The calendar is fully AI-generated — Claude regenerates it weekly using its knowledge
of recurring annual events. To influence what it includes, edit the prompt inside
`generateCalendarWithClaude()` in `Code.gs`. For example, add:
> "Prioritize destinations within a 12-hour flight from LAX. Include more Latin America."

### Notification threshold
Change `MIN_MATCH_SCORE` in CONFIG (or filter in `dailyDealCheck`) to receive:
- `'high'` — strong matches only (Munich + September = Oktoberfest). Recommended.
- `'medium'` — includes adjacent timing matches
- `'low'` — any loose connection to a calendar destination

### Adding your own events
You can manually add rows to the **Calendar** tab in your Sheet at any time.
The weekly refresh will overwrite it — to prevent that, add a "pinned" column
and filter those rows out before overwriting in `writeCalendarToSheet()`.

---

## Phase 2 (future)

When you're ready to make this a public product:

- Add Supabase for user accounts and per-user airport/preference storage
- Replace Gmail reading with a Going.com email forwarding address per user
- Add Amadeus API for proactive fare checking (not just Going.com reactive deals)
- Stripe for subscriptions
- Deploy backend to Vercel serverless functions

The Sheet-as-database approach here is intentionally simple and swappable.

---

## Costs

| Service | Cost |
|---|---|
| Google Apps Script | Free |
| Google Sheets | Free |
| GitHub Pages | Free |
| Anthropic API (daily deal check) | ~$0.01–0.05/day |
| Anthropic API (weekly calendar refresh) | ~$0.10–0.20/week |
| **Total** | **< $3/month** |
