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
- The unread arm records every paint of the card as it happens (look, line, and whether updCheckNowClick painted it),
  skipping calls that did not paint (paintUpdateCard returns early during a press). It asserts the press's own paint
  says could-not-reach, and that a status poll carrying the press's look (unreachable) paints could-not-reach too. (FINAL design after challenge-loop
  iterations 1-3; the earlier "counter after the press, wait for one repaint" design below is superseded.)

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

## /challenge-loop (22:28 on; the PR #5201 was opened via REST, which skipped the gate, so this loop runs before its merge)
Iteration 1 (opus): WARNING taken. The original after-press read could still be raced by a status response answered
before the press and handled after its paint. Now every paint is recorded as it happens (look + line); the press
assertion reads the first paint with an unreachable look (the press: polls do not paint during it, and earlier polls
carry the reachable look), and the poll assertion reads the second paint after the press. Stalled waits now print a
named FAIL instead of an unhandled rejection; the stale "wait for one" comment is gone; the header says the poll
assertion guards the fixture's agreement. Re-proven: fixed PASSES 2 of 2; old fixture FAILS only the poll assertion
(its recorded paint: reached:true, "Could not read"), while the press assertion passes, as it should.
Iteration 2 (sonnet): WARNING taken. paintUpdateCard returns early while a press is in flight (line still "Checking."), and a poll answered then already carries the press's look, so the recorder logged a non-paint that findIndex could take for the press. The recorder now logs only calls that painted (line not ending "Checking."); stalls print a named message. Re-proven: fixed PASSES 2 of 2; old fixture FAILS only the poll assertion. Not forced in a test: the in-flight skipped call itself (reasoned from web/index.html:21618).
Iteration 3 (opus): WARNING taken. Nothing tied the 'press' paint to the press, so a press handler that stopped painting would be stood in for by the next poll (the linked stub makes it say could-not-reach). Now the press paint is the first painted by updCheckNowClick (stack). Proven: fixed PASSES; old fixture FAILS the poll assertion only; INJECTED regression (if (0) on updCheckNowClick's paintUpdateCard call, reverted with git checkout) FAILS the press assertion by name.
Iteration 4 (sonnet): WARNING taken. 'The second paint after the press' was a heuristic that two overlapping stale polls could turn red falsely. Now the poll assertion waits for the first non-press paint whose look is unreachable (a poll answered after the press) and asserts its line; with the stubs unlinked no such poll comes and it fails by name. NITs taken: no iteration labels in code comments; the name coupling is commented; the stale Left section marked.
