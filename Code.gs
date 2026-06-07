// ============================================================
// Travel Calendar -- Google Apps Script
// github.com/yourusername/travel-calendar
//
// Two jobs:
//   1. DAILY   -> scan Going.com Gmail label, match deals to
//                calendar, email strong matches, log to Sheet
//   2. WEEKLY  -> ask Claude to regenerate the event calendar
//                via web search, update Sheet
//
// Full setup instructions in README.md
// ============================================================

// -- CONFIG -- (fill these in before first run) ---------------
const CONFIG = {
  ANTHROPIC_API_KEY: 'YOUR_ANTHROPIC_API_KEY',   // console.anthropic.com
  YOUR_EMAIL:        'sstgermain18@gmail.com',
  HOME_AIRPORT:      'LAX',
  GOING_LABEL:       'Label_3413673769644330550', // your confirmed Going.com label ID
  SHEET_ID:          'YOUR_GOOGLE_SHEET_ID',      // from Sheet URL after /d/
  LOOKBACK_DAYS:     2,    // days back to scan for new Going.com emails
};

// -- SHEET TAB NAMES ------------------------------------------
const TABS = {
  CALENDAR:  'Calendar',   // week-by-week event data
  DEALS:     'Deals',      // matched flight deals log
  META:      'Meta',       // last-updated timestamps
};

// ============================================================
// TRIGGERS -- set these up in Apps Script > Triggers
// ============================================================

// Run every day at 8am
function dailyDealCheck() {
  Logger.log('=== Daily deal check started ===');
  const emails = fetchGoingEmails();
  Logger.log(`Found ${emails.length} Going.com emails`);
  if (emails.length === 0) return;

  const calendar = loadCalendarFromSheet();
  const results  = [];

  for (const email of emails) {
    Logger.log(`Analyzing: ${email.subject}`);
    try {
      const analysis = matchDealToCalendar(email, calendar);
      if (analysis) results.push({ ...email, ...analysis });
      Utilities.sleep(600);
    } catch(e) {
      Logger.log(`Error: ${e}`);
    }
  }

  const strongMatches = results.filter(r => r.matchFound && r.matchScore === 'high');
  logDealsToSheet(results);

  if (strongMatches.length > 0) {
    sendDealDigest(strongMatches, results.length);
    Logger.log(`Emailed ${strongMatches.length} strong matches`);
  } else {
    Logger.log('No strong matches today -- no email sent');
  }

  updateMeta('lastDealCheck', new Date().toISOString());
}

// Run every Sunday at 11pm
function weeklyCalendarRefresh() {
  Logger.log('=== Weekly calendar refresh started ===');
  const calendar = generateCalendarWithClaude();
  if (calendar && calendar.length > 0) {
    writeCalendarToSheet(calendar);
    updateMeta('lastCalendarRefresh', new Date().toISOString());
    Logger.log(`Calendar refreshed -- ${calendar.length} entries written`);
  } else {
    Logger.log('Calendar generation failed -- keeping existing data');
  }
}

// ============================================================
// GMAIL
// ============================================================

function fetchGoingEmails() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.LOOKBACK_DAYS);
  const dateStr = formatDateForGmail(cutoff);

  const threads = GmailApp.search(
    `label:${CONFIG.GOING_LABEL} from:going.com after:${dateStr}`,
    0, 50
  );

  return threads.map(thread => {
    const msg = thread.getMessages()[0];
    if (!msg) return null;
    return {
      subject:   msg.getSubject(),
      snippet:   msg.getPlainBody().replace(/\s+/g, ' ').trim().substring(0, 500),
      date:      msg.getDate().toISOString(),
      permalink: `https://mail.google.com/mail/u/0/#inbox/${thread.getId()}`,
    };
  }).filter(Boolean);
}

function formatDateForGmail(date) {
  return `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
}

// ============================================================
// DEAL MATCHING -- Claude analyzes each email against calendar
// ============================================================

function matchDealToCalendar(email, calendarText) {
  const prompt = `You are analyzing a Going.com flight deal email from ${CONFIG.HOME_AIRPORT} and checking if it aligns with a curated travel event calendar.

TRAVEL CALENDAR:
${calendarText}

DEAL EMAIL:
Subject: ${email.subject}
Body preview: ${email.snippet}

Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "destination": "City or region",
  "country": "Country",
  "price": "$XXX or 'Xk points'",
  "travelWindow": "months or season mentioned in the email",
  "matchFound": true or false,
  "matchScore": "high", "medium", or "low",
  "calendarEvent": "Name of the matching calendar event, or null",
  "calendarTiming": "Exact dates of that event, or null",
  "matchDetails": "1-2 sentences: why this deal timing aligns with the calendar event, or why it doesn't",
  "bookAhead": true or false
}

Score guide:
- high: destination + travel window directly overlaps a named calendar event
- medium: destination is on the calendar but timing is adjacent or approximate
- low: destination is nearby or loosely related to a calendar event
- matchFound false: no relevant calendar event exists for this destination + window`;

  return callClaude(prompt, 400);
}

// ============================================================
// CALENDAR GENERATION -- Claude regenerates weekly via web search
// ============================================================

function generateCalendarWithClaude() {
  const prompt = `Generate a comprehensive week-by-week global travel calendar for the next 12 months (starting from today, ${new Date().toLocaleDateString('en-US', {month:'long', year:'numeric'})}).

For each week of each month, recommend 2-4 destinations that are at their absolute best during that specific window -- driven by festivals, cultural events, ideal weather, seasonal food, or natural phenomena that only happen at that time.

Use your knowledge of recurring annual events and their typical dates. Be specific about event names and approximate dates.

Respond ONLY with a valid JSON array (no markdown, no backticks, no explanation). Each element:
{
  "month": "January",
  "weekLabel": "Jan 1-7",
  "weekStart": "2026-01-01",
  "weekEnd": "2026-01-07",
  "destination": "City, Country",
  "region": "europe|asia|americas|africa|oceania",
  "event": "Event or reason name",
  "eventDates": "Specific dates e.g. Jan 5-Feb 15",
  "hook": "1-2 sentence description of exactly why this week is special here",
  "bookAhead": true or false
}

Include at least 3 entries per week. Mix regions. Prioritize time-locked events (festivals, bloom seasons, harvests, astronomical events) over general good-weather picks. Include lesser-known picks alongside famous ones.`;

  const result = callClaude(prompt, 8000);

  if (!result) return null;

  // callClaude returns parsed JSON for calendar (array), raw object for deals
  if (Array.isArray(result)) return result;
  return null;
}

// ============================================================
// CLAUDE API
// ============================================================

function callClaude(prompt, maxTokens) {
  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': CONFIG.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    muteHttpExceptions: true,
  });

  const data = JSON.parse(response.getContentText());
  if (data.error) {
    Logger.log(`Claude API error: ${JSON.stringify(data.error)}`);
    return null;
  }

  const raw = (data?.content?.[0]?.text || '').trim();
  try {
    // strip any accidental markdown fences
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    Logger.log(`JSON parse error. Raw: ${raw.substring(0, 200)}`);
    return null;
  }
}

// ============================================================
// GOOGLE SHEET -- read / write
// ============================================================

function getSheet(tabName) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  return sheet;
}

function writeCalendarToSheet(entries) {
  const sheet = getSheet(TABS.CALENDAR);
  sheet.clearContents();

  const headers = ['month','weekLabel','weekStart','weekEnd','destination','region','event','eventDates','hook','bookAhead'];
  sheet.appendRow(headers);

  for (const e of entries) {
    sheet.appendRow(headers.map(h => {
      const val = e[h];
      if (val === undefined || val === null) return '';
      if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
      return String(val);
    }));
  }

  // make it publicly readable as JSON via the sheet's web app publish
  Logger.log(`Wrote ${entries.length} calendar rows to sheet`);
}

function loadCalendarFromSheet() {
  const sheet = getSheet(TABS.CALENDAR);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No calendar data available yet.';

  // convert rows to readable text for Claude's context
  const headers = data[0];
  const rows = data.slice(1);
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return `${obj.weekLabel}: ${obj.destination} -- ${obj.event} (${obj.eventDates}). ${obj.hook}`;
  }).join('\n');
}

function logDealsToSheet(deals) {
  const sheet = getSheet(TABS.DEALS);

  // write headers if sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['date','subject','destination','country','price','travelWindow',
                     'matchFound','matchScore','calendarEvent','calendarTiming',
                     'matchDetails','bookAhead','permalink']);
  }

  for (const d of deals) {
    sheet.appendRow([
      new Date().toISOString(),
      d.subject      || '',
      d.destination  || '',
      d.country      || '',
      d.price        || '',
      d.travelWindow || '',
      d.matchFound   ? 'TRUE' : 'FALSE',
      d.matchScore   || '',
      d.calendarEvent  || '',
      d.calendarTiming || '',
      d.matchDetails   || '',
      d.bookAhead      ? 'TRUE' : 'FALSE',
      d.permalink    || '',
    ]);
  }
}

function updateMeta(key, value) {
  const sheet = getSheet(TABS.META);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['key', 'value']);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

// ============================================================
// EMAIL DIGEST
// ============================================================

function sendDealDigest(matches, totalScanned) {
  const today = new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'});

  const cardsHtml = matches
    .sort((a,b) => (b.matchScore === 'high' ? 1 : 0) - (a.matchScore === 'high' ? 1 : 0))
    .map(m => `
      <div style="background:#fff;border-radius:12px;padding:20px 24px;margin-bottom:12px;border:1px solid #e8e8e8;border-left:4px solid #1D9E75;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
          <span style="font-size:17px;font-weight:600;color:#1a1a1a;">${m.destination || ''}${m.country ? ', '+m.country : ''}</span>
          <span style="font-size:17px;font-weight:600;color:#1D9E75;">${m.price || ''}</span>
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:8px;">${m.subject || ''}</div>
        <div style="font-size:14px;color:#444;line-height:1.6;margin-bottom:12px;">${m.matchDetails || ''}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${m.calendarEvent ? `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:1px solid #5DCAA5;">${m.calendarEvent}</span>` : ''}
          ${m.calendarTiming ? `<span style="font-size:11px;padding:3px 9px;border-radius:20px;border:1px solid #e0e0e0;color:#666;">${m.calendarTiming}</span>` : ''}
          ${m.travelWindow ? `<span style="font-size:11px;padding:3px 9px;border-radius:20px;border:1px solid #e0e0e0;color:#666;">Window: ${m.travelWindow}</span>` : ''}
          ${m.bookAhead ? `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#FFF8E1;color:#856400;border:1px solid #FFD54F;">Book ahead</span>` : ''}
          ${m.permalink ? `<a href="${m.permalink}" style="margin-left:auto;font-size:13px;color:#1D9E75;text-decoration:none;">View deal -></a>` : ''}
        </div>
      </div>`)
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px 16px;background:#f5f5f5;">
  <div style="margin-bottom:24px;">
    <h1 style="font-size:22px;font-weight:700;margin:0 0 4px;"> Flight deal alert</h1>
    <p style="font-size:14px;color:#666;margin:0;">${today} . ${matches.length} strong match${matches.length > 1 ? 'es' : ''} from ${totalScanned} deals scanned</p>
  </div>
  ${cardsHtml}
  <div style="font-size:12px;color:#aaa;margin-top:24px;text-align:center;">
    <a href="YOUR_GITHUB_PAGES_URL" style="color:#1D9E75;text-decoration:none;">View full calendar -></a>
    &nbsp;.&nbsp;
    <a href="https://mail.google.com/mail/u/0/#search/from:going.com" style="color:#1D9E75;text-decoration:none;">All Going.com deals -></a>
  </div>
</body></html>`;

  GmailApp.sendEmail(
    CONFIG.YOUR_EMAIL,
    ` ${matches.length} calendar match${matches.length > 1 ? 'es' : ''} -- Going.com`,
    '',
    { htmlBody: html }
  );
}

// ============================================================
// MANUAL UTILITIES
// ============================================================

// Run this once to bootstrap the calendar before the weekly trigger fires
function bootstrapCalendar() {
  Logger.log('Bootstrapping calendar...');
  weeklyCalendarRefresh();
}

// Run this to test a single deal analysis
function testDealMatch() {
  const calendar = loadCalendarFromSheet();
  const result = matchDealToCalendar({
    subject: ' Calgary / Banff National Park -- $293 (Sep-Nov / Jan)',
    snippet: 'The Calgary Stampede gets the headlines every July, but the real reason to fly in is Banff.',
    permalink: 'https://mail.google.com',
  }, calendar);
  Logger.log(JSON.stringify(result, null, 2));
}

// Run this to verify your Sheet ID and tab structure
function testSheetConnection() {
  updateMeta('testKey', 'Sheet connection works -- ' + new Date().toISOString());
  Logger.log('Sheet connection OK');
}
