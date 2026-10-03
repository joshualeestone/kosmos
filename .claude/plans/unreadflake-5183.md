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
  answers.status.updateLook before answering. Only unread and current ever press (armed opens the
  confirm, manual/staging hide the button, rollback never presses); current writes {true,true}, the
  same as its readLook, so only unread changes.
- New assertion (unread): wrap window.paintUpdateCard with a counter after the press, wait for one
  repaint, then read again; the line must still be "Could not reach the update server."
  (Review round 1 WARNING: the first version waited for any /api/status response plus 400 ms, which
  could read before a slow repaint and pass without one. The counter makes the read follow a real paint.)

## Proof (alone, sandboxed board booted as the harness does: fake-tmux, DRY_RUN, first run completed)
- new assertion + old fixture: FAIL 2 of 2 ("Could not read the update server's answer.")
- new assertion + fix: PASS (unread 6/6; armed 7, current 1, manual 11, rollback 5, staging 11 unchanged)
- main's check, same runner: PASS (rules out the runner)
Runner: ~/.cache/claude-handoffs/baron-jobs/run-win32manual.sh

## Weakest premise
The red proves the poll repaint deterministically; that THIS is what #4812's retries hit is
inferred from the identical failing line, not reproduced under load.

## Review
Round 1 (blind): no blockers; 1 WARNING (fixed: paint counter), 3 NITs (comment rewritten; plan
corrected; the uncaught waitFor matches the file's existing style, kept). Re-proven after the fix:
old fixture FAILS, fixed PASSES 2 of 2.

Round 2 (blind): no blockers, no warnings; confirmed the wrap intercepts all three bare-name callers
(acorn: top-level in a classic script, no aliases) and that the press's paint cannot be counted.
2 NITs taken: wait for TWO paints (a status request in flight across the click can carry the
pre-press look, as on a real board), and the header now says the stubs are linked. Re-proven:
old fixture FAILS, fixed PASSES 2 of 2. Converged.

## Left
 full tools/browser-checks.sh on the exact head; PR; merge after Monday.
