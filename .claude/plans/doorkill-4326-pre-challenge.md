---
pre_challenge: true
method: challenge-loop
branch: doorkill-4326
diff_hash: 1571285cb4a558d1cbd6be10ba057c010cf62cbb59aff9686396c049d82a23e0
validation: not run locally in full (memory pressure on this Mac, swap ~5.6 GB); targeted suites passed; CI on this PR is the record
subdir_audit: passed (no subdir CLAUDE.md in the diff)
timestamp: 2026-09-28T12:15:53Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, sonnet, opus)
**Converged:** Yes (iteration 3 found no blocker or major; its minors were fixed)
**Findings:** 1 BLOCKER, 3 MAJOR, about 9 MINOR, 6 NIT; all fixed or stated in the guard's NOT SEEN list

**Validation, stated exactly:** the full local suite was NOT run. This Mac is under memory pressure
(swap 5 to 5.6 GB, and a heavy run was killed for low memory tonight), and the operator asked for heavy
runs to wait. What ran, under tools/run-tests.sh's exact env and preloads, on this head:
- every test file mentioning github, vercel, the bin overrides, devicedoor, runnable or promisify
  (1574 tests): 0 failures, and the guard refused nothing;
- the branch's own tests and engine.runnable-not-directory's audit: 41/41.
This PR's own CI (the full suite on a clean runner) is the validation of record. It merges only if green.

#### Iteration 1 - opus - 1 BLOCKER, 2 MAJOR, 3 MINOR, 3 NIT
- BLOCKER: the guard dropped execFile's promisify.custom, breaking every promisified caller. Fixed;
  the three files it broke pass (58/58).
- MAJOR: runBounded spawned detached, so a board restart left the probe orphaned (the #4326 harm).
  It now stays in the board's group; a test kills a "board" group and checks the probe goes too.
- MAJOR: exec / shell:true / sh -c bypassed the guard. It now checks command words in scripts.
- Also: #4309 (nohostcli.js) had already fixed the three connections tests; my pins there were
  reverted. Windows (child.kill, windowsHide), relative cwd, output order, and the invented variable name.

#### Iteration 2 - sonnet - 1 MAJOR, 2 MINOR, 1 NIT
- MAJOR: bash -lc, fish -c, cmd /c and pwsh -Command bypassed the guard. Fixed; a row for each.
- MINOR: stop at once on overflow (execFile's maxBuffer); clear the SIGKILL timer on error.

#### Iteration 3 - opus - no blocker or major; minors fixed
- Quote-aware script splitting; bare names judged by the call's PATH; stop collecting after the
  answer; an honest NOT SEEN list; the guard test uses a harmless stand-in "real" dir via a test
  seam, so no run can reach the operator's CLI. After the rebase, the #1592 audit caught an
  access-with-X_OK check in the guard's PATH lookup; it is now a stat.
