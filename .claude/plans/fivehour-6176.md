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
- `engine/kosmos-statusline.js`: `fiveHourOf()`; `record()` takes `{ file, tolerance, history }` (weekly by default,
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
