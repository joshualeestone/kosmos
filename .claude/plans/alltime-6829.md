# #6829: Token Usage counts all time since install, not a fixed 14 days

Josh, #admin 2026-10-21 07:54 CDT: "this should be all time usage beyond 14 days and for new users should only
start counting on those days from install forward".

## Finished looks like

On a fresh install the Active Days tile shows the days since install (1 on install day). On an install older
than 14 days, the hero totals, model table, donut, agent split and history include every day since install that
is still recoverable. The four daily charts keep a 14-day window. Read in the served build, with a control that
fails on the 14-day version.

## What was measured (Agent1s, 2026-10-21 08:00 CDT)

- The engine does NOT prune. `engine/usage.js` freezes each completed day to `<data>/usage/<day>.v2.json` and
  never deletes one.
- Claude Code DOES: `cleanupPeriodDays` is unset in every config root here (default 30), and the oldest top-level
  transcript left is from 09-21.
- Kosmos freezes a day only when a request's window covers it. The page asks for 14, so a day is kept only if
  someone opened Token Usage within 14 days after it. On this Mac 30 of the 50 days from 08-21 to 10-09 are frozen,
  and none since 10-10 (nobody opened the page). The other days are lost where their transcripts are gone.
- The tile always says 14: `paintUsage` passes `Object.keys(byDay).length`, and byDay has a key for every
  requested day, empty or not.

## Design

1. **Install day** (`engine/ping.js`, `engine/usage.js`). `ping.installId()` mints the install id on the first
   board start; it now also records `installedAt` in the same write. `ping.installedAt()` returns that field, or
   for an install that predates it, ping.json's mtime (the file is written once, when the id is minted). usage
   `installDay()` is the earliest UTC day among that and first-run.json's `completedAt`; with neither, today.
   - Rejected: the data folder's birth time (on this Mac it is 09-07, after usage frozen from 08-21: the folder was
     recreated), the oldest file in the data folder (an avatar copied in with an 08-07 mtime), and the earliest
     frozen usage day (a 14-day request on a new install freezes 13 days BEFORE install).
2. **All-time read**. `usage.usageSinceInstall()` = `dailyUsageByModel(days from install day to today)`, plus
   `installDay` and `days`. `/api/usage?days=all` uses it and adds `installDay` and `daysOnKosmos` to the answer;
   a numeric `days` behaves as before.
3. **Stop the loss going forward**. The server runs the all-time read once a few minutes after start and every 6
   hours, so every completed day is frozen while its transcripts still exist, whether or not anyone opens the page.
   Not under the test runner. One in flight at a time.
4. **Page** (`web/index.html`). Fetch `?days=all`. Active Days = `daysOnKosmos`. The four charts get the last 14
   days of the series; everything else is all-time. Copy: the hint says since Kosmos was installed on this
   computer, charts the last 14 days; the empty message no longer says fourteen days.

## Lost history on existing installs (goes on the card)

A day before the fix is recoverable only if it was frozen (someone viewed Token Usage within 14 days of it) or its
transcripts still exist (Claude keeps about 30 days). Everything else is gone and is counted as zero.

## Weakest premise

ping.json's mtime as the install time for existing installs: it holds only if nothing rewrote the file after the
id was minted. A rewrite moves it LATER, so the count could start late, never early. first-run's completedAt is
the second signal for that reason.

## Tests

- engine: installDay from installedAt, from mtime, min with first-run, today when neither; usageSinceInstall
  window starts at install day; server `days=all` answers installDay and daysOnKosmos.
- web: the render asks for `days=all`; Active Days comes from daysOnKosmos (a 14-day byDay with daysOnKosmos 1
  shows 1, the control); charts get only the last 14 days.
- browser-check render-token-usage-2617 updated for the new fetch.

## Decided while building

- Each chart card's header total and share stay ALL-TIME (they are totals); the line under them is the last 14
  days, and its aria-label says how many days it draws. Rejected: windowed header totals, which would make the four
  cards disagree with the hero above them.
- Active Days without `daysOnKosmos` (an older board answering a newer page) counts days that have any usage,
  never the number of days in the answer.
- `engine/installid-senders-5995.test.js` lists `engine/usage.js` as a reader of engine/ping.js: it reads
  `installedAt` only, never the id. ping.js's header names the field.
- Measured on Agent1s for the card: 61 days since 08-21; 30 saved, 18 lost (08-28 to 09-06, 09-13 to 09-20),
  13 not saved but still recoverable (reasoned from the oldest transcript, 09-21; the first save reads them).
- Review round 3 redesign: a partial scan (an unreadable transcript) is HELD from saving only in the board's own
  timed save (`holdPartial`), and only for days newer than 20 days; a page request saves as it always did, so a
  lasting bad file cannot turn every open into a full rescan. Rejected: holding for every caller (rounds 1-2), which
  made a permanent bad file block saving and slow every open.
- Every all-time read (page and timed save) runs in turn (`inTurn`), so the first open after the update and the
  first save do not scan the same weeks at once.
- The status line says, past 30 days on Kosmos, that Claude removes transcripts after about 30 days so an older day
  counts only if Kosmos saved it in time. Rejected: an exact list of lost days, which the engine cannot know.
- Validation: focused test files run on each review round; the full suite runs once on the final head (two
  mid-loop full runs were stopped because the next round changed the code under them).
