# undodate-30day: engine/undo-5153's fixed dates expired

## Why
engine/undo-5153.test.js wrote every time on 2026-10-01 and called undo.plan() with the real clock. undo.js:470 flags a
hold older than KEEP_DAYS (30) as incomplete, so from 2026-10-31T10:00Z (the tests' holds start at 10:00) the test "undo
puts an edited file back" failed on main and every PR (suite (node), CI run 41191583447 on PR #7669, reproduced on
origin/main). engine/undo-credential-4491.test.js has the same fixed day; it still passed only because its two CONTROL
checks also accept 'incomplete' (allowed for an earlier test switching undo on late), so they could no longer fail.

## Finished looks like
- The test's day is yesterday (UTC), computed at load: every time is in the past and inside the 30-day window on any
  day the suite runs, in both engine/undo-5153.test.js and engine/undo-credential-4491.test.js. undo.fsync-5434 also
  writes 2026-10-01 but reaches plan() only through apply(..., { now }), so its clock is pinned and it is left alone.

## Decided
- Relative dates, not an injected clock: ~30 undo calls in the file, and undo.js reads Date.now internally (setOn,
  agentSessions, keep and sweep defaults); a partly injected clock leaves the bomb in any call missed.
- Weakest premise: a run straddling UTC midnight. DAY is computed once at load, so every time stays the same day and in
  the past; nothing compares against "today".
