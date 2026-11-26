---
pre_challenge: true
method: challenge-loop
branch: qhgroup-9118
diff_hash: 423dbce29f8769cf994cecb9b1c66a04ae8d8418e8e1cd3d70b1daf50e2be14d
validation: passed (validation_log_run_or_skip, full suite through queued-heavy on this Mac, head 9bbb209ff9, clean tree, 06:4x CST 11-26; "validation PASSED for stack=typescript hash=423dbce29f87")
subdir_audit: passed
timestamp: 2026-11-26T12:51:47Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the fleet's cap)
**Converged:** No. Stopped at the 8-round cap. Rounds 4, 6 and 7 found no BLOCKER or MAJOR. Round 8 found one BLOCKER in the TEST file only (the terminal arms used BSD script, which CI's Linux shards reject); it was fixed after round 8 and NOT reviewed again. The PR's Linux shell shards are its proof, and the merge waits for them.
**Total findings:** 1 BLOCKER (test), 5 MAJORs (4 code, 1 test), 25 MINORs, many NITs
**Fixed:** the BLOCKER, all 5 MAJORs, every MINOR that was a defect | **Accepted with reasons:** a few MINORs and NITs (below) | **Asked:** 0

The full record is .claude/plans/qhgroup-9118-reviews.md. Every fix landed with an arm, and each arm was shown red on the previous round's script or a targeted mutation before it counted.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 MAJOR, 4 MINORs (at 0ada1ae2af)
- [MAJOR] the group stop also ran after a normal exit, with a false "signalled" line --> FIXED (stop only when the wrapper ends early)
- [MINOR] 08 grace octal; terminal-reading command hung in the background; caller's group KILL orphaned the command; default grace unpinned --> FIXED

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 MAJOR, 4 MINORs (at f98d5b029b)
- [MAJOR] the watcher watched the leader, not the group --> FIXED
- [MINOR] Killed job report in every log; fork-to-$! window; controlling terminal with stdio redirected; no stdin arm --> FIXED

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 MAJOR, 2 MINORs (at 9e593c1ec6)
- [MAJOR] ALRM/USR1/USR2 released the claim and left the command --> FIXED (keyed on QH_DONE)
- [MINOR] posix-mode /dev/tty probe (not broken in place; made a subshell); watcher second grace --> FIXED / DOCUMENTED

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 MAJORs, 3 MINORs (at 05484f7966): release-after-stop and the watcher's end pinned; ALRM/USR recorded in the fork --> FIXED

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 MAJOR (test), 3 MINORs (at bb83d9acc7): ALRM arm red once under load --> FIXED (160/160 twice, second at load 74)

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 MAJORs, 4 MINORs (at 0de5d75f83): three test races; grace clamped to the claim's life --> FIXED

#### Iteration 7
**New findings:** 0 BLOCKERs, 0 MAJORs, 3 MINORs (at ce597d2e05): RENEW_SEC=08 regression in the clamp; clock deadlines; comment --> FIXED

#### Iteration 8
**New findings:** 1 BLOCKER (test), 0 MAJORs, 2 MINORs (at 27ac7ddf5e)
- [BLOCKER] tty and ctty arms used BSD script; util-linux script rejects it --> FIXED after round 8 (ttyrun helper), NOT re-reviewed
- [MINOR] caller's group KILL leaves the cleanup unclaimed (bounded, documented); whole-second deadline --> ACCEPTED

### Accepted, stated in the PR
- After a SIGKILL of the wrapper the claim reads free while the watcher stops the command (about 5 s plus the grace).
- A microsecond window between the command's fork and the watcher's fork leaves a SIGKILL there unwatched.
