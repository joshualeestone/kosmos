---
pre_challenge: true
method: challenge-loop
branch: updaterestart-4818
diff_hash: 05976abac6de2afaf50bade0b90c7129dc990a4b0bba4fafd2f8b7b0a7cbda71
validation: focused at a3dd1d5dd - tools/test-update-putback-4818.sh 17/17 (the shipped lines, a fake kosmos on a real port, signals), the installer shell tests near the pause (#2055 10/10, #964 12/12, install-static 23/23 and its control, runnable guard, progress emit, resolve user, zsh tied names) and the wiring tests (every-test-runs, shell shard, install reachable, local board: 64/64); a Mortals full run is queued at 7c05525f3 (code-identical but for this test and the plan); GitHub CI runs the full suite on the merge ref and is the merge gate
subdir_audit: passed
timestamp: 2026-10-01T02:33:53Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind rounds, 2026-09-30
**Converged:** Yes (rounds 5 and 6: no blocker; round 6 also no should-fix, "would ship it tonight")
**Findings:** 0 BLOCKERs; 10 WARNINGs, all taken; NITs taken or recorded in the plan

### Validation
Focused, at the head above: the put-back test (17 arms), every installer shell test that extracts lines near the
update pause, and the test-wiring tests, all green. A Mortals full run is queued; CI on the merge ref is the gate.

### Iteration 1: 0 BLOCKER, 2 WARNING
- [WARNING] install/setup.sh - a connect-mode switch during the run kept its board off only until a failure --> FIXED: the put-back re-reads the mode
- [WARNING] tools/test-update-putback-4818.sh - re-typed the shipped started line; no die() arm --> FIXED: extracted; die() arm added
- [NIT] the message claimed the old version; the start did not reclaim a busy port --> FIXED

### Iteration 2: 0 BLOCKER, 1 WARNING
- [WARNING] install/setup.sh - a hang-up (window closed) or TERM ran the EXIT trap with status 0 --> FIXED: trap 'exit 1' HUP TERM; tested

### Iteration 3: 0 BLOCKER, 2 WARNING
- [WARNING] install/setup.sh - armed only after the port wait, so a port survivor or a hang-up in that wait left the board off --> FIXED: armed before the port wait, after the three dies that must not restart; pinned by line order
- [WARNING] tools/test-update-putback-4818.sh - the signal arms could race the fork --> FIXED: they wait for the child

### Iteration 4: 0 BLOCKER, 2 WARNING
- [WARNING] install/setup.sh - a busy board (54 agents) missed the 2 s probe and read as not running --> FIXED
- [WARNING] install/setup.sh - another install's board on the port could read as ours --> FIXED (by the arming position)

### Iteration 5: 0 BLOCKER, 1 WARNING
- [WARNING] install/setup.sh - a board crash-looping or mid-restart had no live pid, so it read as not running --> FIXED: "was running" is the person's settings (no board.stopped, a mode that runs it here)
- [NIT] a second short probe after the start told a busy board's person it had not started --> FIXED: the start's own verdict

### Iteration 6: 0 BLOCKER, 0 WARNING (CONVERGED)
- [NIT] the failed-start message was untested --> FIXED: tested
- [NIT] a failed final start prints a second line after the die --> RECORDED in the plan

Rebased 2026-09-30 22:30 CDT onto main 3b4aa7670 (past the #4796 fix 3b4aa7670): clean, git range-diff shows all 16 commits patch-identical, so the reviewed change is unchanged; the hash is recomputed for the new base.

After the PR (2026-09-30 23:09 CDT): CI found the put-back test's signal arms too tight for a loaded runner; fixed (sleep 120, bound 60, named lookup failure, -s pause wait, reaping fail path). One blind review: no blocker; its should-fix and nits taken. Local 17/17; both mutants behave. Hash recomputed.
