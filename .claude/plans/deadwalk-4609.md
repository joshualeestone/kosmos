# deadwalk-4609: a suite candidate that is gone is not a running suite

Card: #4609 (the run-tests.sh suite queue jams: something that is not a marked waiter keeps being counted as live).
Measurement and mechanism: card comment 5902966954.

## Call
- tools/lib/cut-guard.sh `_kosmos_drop_suite_waiters`: after the waiter walk fails, drop a candidate whose pid is gone
  (`_kosmos_pid_gone`: `kill -0` fails AND the error says No such process). EPERM or an unread error keeps it.
- tools/test-cut-guard.sh: suite-arm stand-ins for a RUNNING suite move from `$DEAD` (an exited pid) to `$SUITE`
  (a live sleep, killed on exit); new #4609 arms: exited candidate dropped, the suite check passes past it, a live one
  kept (control), EPERM pid 1 kept, a malformed pid never gone.

## Rejected
- Re-sampling or sleeping before the walk: narrows the race, does not close it.
- Marking a waiter before its first check (the card's candidate 1): every sampled hit had a marked-waiter parent.
- A seam that skips the existence check under the probe: it would bypass the logic under test.

## Weakest premise
A subshell orphaned while alive (parent exited first, reparented to 1) is still counted live; assumed rare.

## Measured
- tools/test-cut-guard.sh on 5c2f76d78: 131 PASS, 0 failures, twice (rc 0). origin/main control: 0 failures.
- Mutation 1 (the `_kosmos_pid_gone ... && continue` line removed): exactly the two #4609 drop arms red
  (the exited candidate counted live; the suite check refused past it). Restored from HEAD.
- Mutation 2 (`_kosmos_pid_gone` treats any kill -0 failure as gone): the EPERM arm reds. Restored from HEAD.
- Unexplained, recorded: the FIRST branch run left one stray win32-style file
  (`\var\folders\...\kt70202\kt70212\kosmos-w32apply-...\mode`, 21:36:18) in the worktree root. It did not
  reproduce on the second run, and the origin/main control left none. The same class of stray files sits in other
  worktrees (e.g. kosmos-asbrow-4405), so I do not attribute it to this change; not investigated further.
