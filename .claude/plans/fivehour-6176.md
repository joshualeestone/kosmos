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

## Weakest premise
The five-hour figure updates only while a Claude agent on that account is running, so it can be hours old. The line
shows its age, and a reading from a window that has reset is not drawn at all.
