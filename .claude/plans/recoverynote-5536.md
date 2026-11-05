# recoverynote-5536: board notice for a new recovery (kosmos#5536, #5529)

The board tells a member their own backup was opened to someone, as the reviewer notice (#6817) does for a new reviewer. Built dark on PR #8028: no `recoveries` from the coordinator, no notice.

## Calls
- Read: /api/org/grants carries `recoveries` (screen only, cleaned, never to a family, left out when empty). It spends no one-time note, and the notice shares the reviewer notice's once-a-minute read.
- New: a row unseen in this browser, inside 30 days. Key: at, what, who, epoch, count.
- Show: its own slot and seen list, See who and x. "Someone opened files from your backup." when an unseen row says so, otherwise "Someone was given access to your backup.", because a key given opens nothing by itself. It names nobody: the board is on screen for anyone in the room.
- First load: a new browser, or cleared site data, shows the notice once for up to 30 days of rows. Intended: nothing says this browser has seen them, and missing a recovery is the worse way to be wrong. The reviewer notice does the same.
- Seen: the x or the list in view. Opening Settings alone is not seen.

## Rejected
- Inside the reviewer notice: closing one must not clear the other.
- A separate route: the grants route already exists to spend nothing.

## Weakest premise
The wording, which a designer has not read. What would change my mind: a designer or Josh.

## Files
web/index.html, server.js, web.reviewerptr-6817.test.js (lifts the read, handed the recovery half), web.recoverynote-5536.test.js, server.recoverynote-5536.test.js, docs/browser-checks/render-recoverynote-5536.js and its three wiring rows.
