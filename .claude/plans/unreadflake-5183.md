# unreadflake-5183: the unread arm's status stub follows the press

Card: kosmos#5183 (Baron, claimed; Splinter 16:59: merge after Monday).

## Cause (measured, corrects the card's first guess)
render-update-win32-manual stubs POST /api/update/check (the press) and GET /api/status (the poll)
separately. In the unread state the press answers reached:false while the status stub keeps
updateLook {reached:true, readable:false}. On a real board both come from one cache
(engine/update.js checkNow writes it, lastLook reads it), so they cannot disagree. A poll landing
after the press repaints the card with the pre-press "Could not read the update server's answer."
Under load the poll lands before the read: #4812's run retried twice.
Not network: there is no network in this arm, so a refused connection (the card's first
suggestion) would fix nothing.

## Change
- docs/browser-checks/render-update-win32-manual.js: the check stub writes the press's look into
  answers.status.updateLook before answering (for every state; in the reached states it writes what
  the status already said).
- New assertion (unread): wait for one /api/status response after the press, then read again; the
  line must still be "Could not reach the update server."

## Proof (alone, sandboxed board booted as the harness does: fake-tmux, DRY_RUN, first run completed)
- new assertion + old fixture: FAIL 2 of 2 ("Could not read the update server's answer.")
- new assertion + fix: PASS (unread 6/6; armed 7, current 1, manual 11, rollback 5, staging 11 unchanged)
- main's check, same runner: PASS (rules out the runner)
Runner: ~/.cache/claude-handoffs/baron-jobs/run-win32manual.sh

## Weakest premise
The red proves the poll repaint deterministically; that THIS is what #4812's retries hit is
inferred from the identical failing line, not reproduced under load.

## Left
Full tools/browser-checks.sh on the exact head; blind review; PR; merge after Monday.
