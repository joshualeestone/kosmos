# fivehour-6176: Claude's 5-hour limit in Settings (kosmos#6176 slice 1)

#6176 is the umbrella of #6108's follow-ups. Ice Cream Kitty has the other-computers slice; this branch is slice 1 of
the rest. The slice plan is on the card (16:55 CDT 10-14).

## Done when
- A Claude account row in Settings > AI Models shows "N% of its 5-hour limit used · resets <time> · Kosmos last saw it
  change <age>" as its own meter under the weekly one, whenever Kosmos has a current five-hour reading.
- It warns at the weekly thresholds ("Close to its 5-hour limit.", and at 100% "At its 5-hour limit until <time>.")
  and never suggests a move.
- No reading, an API key, or a window that has reset: no five-hour line. A five-hour-only row shows it in place of
  "No usage reading yet".
- Tests: the statusline records it (engine), the route serves it (server), the page draws it (browser check).

## Source (measured, not assumed)
Kosmos's own statusline (`engine/kosmos-statusline.js`) already receives `rate_limits.five_hour {used_percentage,
resets_at}` on every update and used to drop it. Nothing new is installed: accounts already wired for the weekly
reading record the five-hour one on their next update.

## Built
- `engine/kosmos-statusline.js`: `fiveHourOf()`; `record()` takes `{ file, tolerance, history, maxAheadSeconds }` (weekly by default,
  unchanged); `main()` also records the five-hour reading in `kosmos-fivehour.json`, forward-only within one window
  (1 h tolerance), no history.
- `engine/allowance.js`: `readFiveHour(dir, now)`, null when unreadable or the window has reset.
- `server.js`: each Claude row in `/api/accounts` gains `fiveHour {usedPct, resetsAt (ms), at (ms)} | null`.
- `web/index.html`: `acctUsageHtml` draws `.acct-usage-meter.acct-usage-five` under the weekly meter.
- Tests: `engine/allowance-fivehour-6176.test.js`, a #6176 test in `server.allowance-3946.test.js`,
  `docs/browser-checks/render-account-fivehour-6176.js` (gated.txt, README), a `settings-accounts-fivehour` shot screen.

## Calls
1. Its own file, not a field in the weekly file: the weekly history and its calibration stay untouched.
2. No move suggestion on the five-hour line: it resets within hours, so the cure is waiting, not another account.
3. The reset time shows only the time when it is today, the weekday as well when it is not.

## Known limits
- A list left open re-reads at the soonest five-hour reset only while Settings is on screen. If that read keeps failing
  (ten tries a minute apart), a line past its reset stays until the next repaint.

## Weakest premise
The five-hour figure updates only while a Claude agent on that account is running, so it can be hours old. The line
shows its age, and a reading from a window that has reset is not drawn at all.

## After the rebase onto main (2026-10-15)
- #6175 landed a "Set up usage reading" offer for accounts that are not set up. On a row with a five-hour reading it comes
  after the five-hour line and the note (never between the meters and their note), and a five-hour-only row offers it too.
- Every reason a reading stops updating has its plural words for two readings (linked-settings was missing).
- The move menu offers no target at its five-hour limit until that resets (a reading past its reset does not count).
- A background read that fails before a reset no longer cancels the read at the reset: the timer is set again from the
  resets on screen, and a list busy at that moment is tried again a minute later within the same ten tries.
- Decided, not built: the move menu still labels a target with its weekly figure only. A target near its five-hour
  limit is left in, because that limit resets within hours (moved agents would wait, not fail); a target AT it is left
  out. Rejected: naming the five-hour figure in every option, which doubles the label for a few hours' difference.
- A read at the reset that comes back to a busy list (a Check started during it) keeps the five-hour retry armed, so
  the line goes once the list is free, even after the follow-up has given up waiting.
- Known, accepted: every repaint replaces the five-hour timer only once its read succeeds, so a line can sit past its
  reset for the length of one read. The failed-read retries and the busy-list retries share one budget of ten tries
  in a row; a successful paint starts it again.
- Switching back to AI Models from another Settings section reads the list again if a five-hour line on it is past its
  reset (the timer stops while the list is hidden, and a section switch does not repaint), or sets the timer again.
- The read on coming back to AI Models waits a moment and runs only if nothing repainted the list meanwhile: opening
  Settings onto AI Models repaints it itself, and a second read would run every account's live check twice.
- Once a line's ten retries are spent (failed reads or a busy list), the other lines still keep the timer for their own
  reset. One pending on-show look at a time, so switching to AI Models twice reads once. (Measured: the epoch check
  already stops the second look, since the first one's repaint raises it; the single handle is belt and braces, and
  the check's double-switch arm proves the behaviour, not the handle.)
- Accepted: a reset read goes through paintAccounts, which can start an other-computers round (#6178's aoKick); that
  is rate-limited to one round per five seconds by AO_KICK_GAP_MS, so it is left alone.
- Not in this branch: a Codex (OpenAI) row's five-hour window (#6203) has no reset timer, so on a list left open it can
  stay past its reset until the next paint. Noted on #6176.
- Opening Settings onto AI Models reads the list once even when Settings' own reads are slow: paintSettings marks an
  open under way until it paints the list, and the on-show look stands down while it is (30 s fail-safe).
- Coming back to the window (visible again, or focus) looks again, because a Mac's sleep does not count on a page
  timer and the reset timer can wake late. Tested by moving the page's system time past the reset without firing
  timers, then focus or visibilitychange. The look never doubles a read already out (acctReadOpen) and never spends
  the ten tries: on a busy list it leaves the armed timers alone.
- Accepted: a list held busy indefinitely (a Disconnect left half-pressed) keeps a line past its reset once the ten
  tries are spent, until the next repaint, another line's reset, or the window being focused again.
- The six-hour sanity bound is one value, FIVE_HOUR_MAX_AHEAD_SECONDS (kosmos-statusline.js), used by record() and by
  allowance.readFiveHour; the route builds the reading through accountsweekly.fiveHourOf beside #6178's weeklyOf.
- The on-show look stands down while a list read is out, but not for one older than 30 s (a hung read), so a read that
  never answers cannot block every later look.
