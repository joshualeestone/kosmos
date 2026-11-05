# recoverynote-5536: board notice for a new recovery (kosmos#5536, #5529)

The board tells a member their own backup was opened to someone, as the reviewer notice (#6817) does for a new reviewer. Built dark on PR #8028: no `recoveries` from the coordinator, no notice.

## Calls
- Read: /api/org/grants carries `recoveries` (screen only, cleaned, never to a family, left out when empty). It spends no one-time note, and the notice shares the reviewer notice's once-a-minute read.
- New: a row unseen in this browser, inside 30 days. Key: at, what, who, epoch, count.
- Show: its own slot and seen list, "Someone was given access to your backup.", See who and x. It names nobody: the board is on screen for anyone in the room.
- Seen: the x or the list in view. Opening Settings alone is not seen.

## Rejected
- Inside the reviewer notice: closing one must not clear the other.
- A separate route: the grants route already exists to spend nothing.

## Weakest premise
One sentence for both kinds of row. A files-opened row whose release aged out reads "was given access": true, and less than the list says.

## Files
web/index.html, server.js, web.reviewerptr-6817.test.js (lifts the read, handed the recovery half), web.recoverynote-5536.test.js, server.recoverynote-5536.test.js, docs/browser-checks/render-recoverynote-5536.js and its three wiring rows.
