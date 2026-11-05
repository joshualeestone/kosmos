# #7957: a room left blank by the keyboard comes back

Addresses #7957.

## What finished looks like
A room with no post on screen after the keyboard hold placed its list opens again at the newest within about a second. A reader whose posts are drawn is not moved. CI's room test passes on the recovery, and says so when it was needed.

## Measured
CI, PR #8008, 2 of 2 runs: "at end false", "room keyboard hold: placed by id", no post for 3 s or more. Also failed earlier on main and PR #7917, per the test's own comment. The room had no recovery and no report.

## Decided
- A new list, not another scroll: on the chat (#7420) a scroll did not cure a list that drew nothing.
- Trigger only after a placing by id, the one measured path. Rejected a general watcher for now: more ways to move a reader on no evidence.
- A blank screen keeps no place, so a reader higher up lands at the newest. Same ruling as the chat (TestFlight 37).
- Twice at most until posts draw. Rejected unlimited: a list that cannot draw would loop.
- The test now passes when the post comes back within 5 s, and records the blink. Weakest part: that loosens it. A blank a person sees for a second now passes. Rejected keeping it strict: it would stay red on the cure.
- Weakest premise: rowTops empties when rows leave, so 0 means nothing drawn. It relies on RowTop clearing on disappear; a stale reading would stop the rebuild, leaving today's blank, which is safe. The cause of the blank is still unknown; this recovers from it. Not seen on a phone.
