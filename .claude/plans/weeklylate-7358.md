# weeklylate-7358: a weekly limit on its last day, seen after a restart, is released once its reset has passed

Card: kosmos#7358 (follow-up from #7264, Josh's agents stuck on Rate Limit after a board restart).

## Finished looks like

After a board restart, a weekly last-day limit row ("resets 6pm", no date) whose reset already passed reads idle at
once when its turn footer carries a done time; with no done time it behaves as today (capped until the next 6pm at
most).

## Cause

A row on screen at the board's first capture is "late": the board does not know when it printed, so #7264 times it
from the sighting. A session limit's clock time does not come round again within its 5 h span after a late
sighting, so #7264 can tell it already passed; a weekly last-day limit's (24 h span) always does, so it read Rate
Limit until the next occurrence, up to a day.

## Fix

The vendor's turn footer under the row says when that turn ended ("✻ Sautéed for 3s · done 5:32 PM"), in this
machine's local time with no date. For a late row, read it as the latest such instant at or before the sighting
(turnDoneAt) and time the reset from it instead of from the sighting. The line printed as that turn stopped, so
its reset is the first after the done time. A footer older than a day reads as a later instant than the truth, so
a row is never retired early on it. No done time: the sighting, as before. A row seen as it arrived is untouched.

## Decided

- Only late rows read the footer: a row the board watched arrive already has an exact time.
- The #7264 sighting tests now use footers with no done time. Their fixed "done 10:35 PM" fitted their timelines
  only when read as Chicago time, so in other zones the new rule (correctly) disagreed with the fixtures. The
  new tests cover done-time timing and write the footer in the suite's own zone.
- Weakest premise: that Claude Code prints the done time in the same zone the board runs in (the same machine,
  normally). An agent launched with a different TZ would shift it by the difference.

## Verify

engine/limitretire-5805.test.js in several zones (all pass in each); each new test fails on the code before; every test file
touching rate limits; full suite before the PR.

## Review bound

Challenge loop to convergence. Merge on green (beta rule).

## Review 1
- The night the clocks go back, a done time in the repeated hour is read as the later instant (setHours takes the
  earlier, which released a weekly limit about a day early); as limitResetTimeOnlyAt already reads a reset.
- A done clock with seconds is not read at all (it read as 12 hours off); a reading it cannot be sure of keeps the
  sighting's timing, so it errs toward staying capped.

## Review 2
- The footer gives the minute only, so the reset is timed from the end of the done minute: a reset in that same
  minute is skipped (the limit may have come after it), erring later.
