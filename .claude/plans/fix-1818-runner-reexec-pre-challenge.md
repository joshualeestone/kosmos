---
pre_challenge: true
method: challenge-loop
branch: fix-1818-runner-reexec
diff_hash: 3415c3bf2b68b4a39ba34c45cf67085fbfd037d44c6a31f9590d12a13bfa2397
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T16:29:23Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 produced zero actionable findings, only NITs)
**Total findings:** 4 actionable + 2 NITs (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 iter-1 NITs, 2 iter-2 NITs)
**Fixed:** 4 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] tools/test-runner-reexec-1818.sh:158 - ARM 3 SUBJECT negative assertion `! has "$out" "another page layer"` was vacuous (the refusal message never contains that phrase); only the rc check discriminated --> FIXED (02276ba8): re-aimed at the real refusal text "already live".
- [CONVENTION] .claude/plans/fix-1818-runner-reexec.md - 12 em dashes (U+2014) in the plan, house style forbids them --> FIXED (02276ba8): stripped all; verified 0 across all 5 spellings in the whole diff.
- [NIT] tools/browser-checks.sh:180 - the documented "parent-only kill thaws mid-run" residual was overstated; bash defers an INT/TERM trap until the foreground child returns --> FIXED (02276ba8): comment + plan corrected to the verified behavior (no mid-run thaw; only SIGKILL leaks, benign and pre-existing).
- [NIT] tools/browser-checks.sh (KOSMOS_BC_TEST_CUTSHORT seam) - the seam left RAN empty, so the incomplete run-log line recorded ran=0 --> FIXED (02276ba8): push a token to RAN so the line reflects ran>0, closer to a real mid-checks kill.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both deferred)
**Duplicates of prior findings:** 0
**Converged** - no new actionable findings. The reviewer empirically re-verified the signal/trap claims (a `kill -TERM` to the parent mid-child did not run the trap until the child returned) and the old-path SIGTERM-EXIT-trap claim; both match reality.
- [NIT] tools/browser-checks.sh:110,292 - internal seams `KOSMOS_BC_FROZEN_RUNNER` / `KOSMOS_BC_TEST_CUTSHORT` are ambient-env-triggerable --> DEFERRED: same risk profile as the pre-existing `KOSMOS_HARNESS_IGNORE_CUT`; cannot leak from normal operation (the child sets FROZEN_RUNNER in a subprocess that exits; nothing exports the test seam); the cut-short seam fails loud; FROZEN_RUNNER is a genuine internal parent->child contract that must be honored when set.
- [NIT] tools/test-runner-reexec-1818.sh:113 - ARM 2 (run in-process via FROZEN_RUNNER=1 against the real $REPO) logs "Running from the frozen runner copy ($REPO)" pointing at the source tree, momentarily untrue in that synthetic context --> DEFERRED: harmless (the arm asserts nothing on that line); making it true would force ARM 2 to do a real freeze, defeating the point of the in-process banner test.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | test-runner-reexec-1818.sh:158 | vacuous negative assertion | FIXED | 02276ba8 |
| 2 | 1 | CONVENTION | plans/fix-1818-runner-reexec.md | 12 em dashes | FIXED | 02276ba8 |
| 3 | 1 | NIT | browser-checks.sh:180 | residual race overstated | FIXED | 02276ba8 |
| 4 | 1 | NIT | browser-checks.sh (seam) | seam left RAN empty | FIXED | 02276ba8 |
| 5 | 2 | NIT | browser-checks.sh:110,292 | seams ambient-triggerable | DEFERRED | accepted pattern (= KOSMOS_HARNESS_IGNORE_CUT); internal contract |
| 6 | 2 | NIT | test-runner-reexec-1818.sh:113 | synthetic log line untrue | DEFERRED | harmless; not asserted; fix defeats the arm |

### Outstanding questions (ASKED, still unresolved)
None.

### Strengths (across all iterations)
- Re-exec wrapped in `run_frozen_runner_then_thaw` (parsed into memory before the call), not inlined or `exec`'d, so the parent stops reading the mutable `$0` before the long child run - correctly avoids reintroducing the very bug (iter 1, 2).
- No double-thaw (parent registers only `_parent_thaw`; child's FREEZE_BUILD empty so its cleanup thaw is a no-op), no re-exec loop, child resolves REPO to the frozen root via `$0` (iter 1, 2).
- Signal/trap reasoning correct and empirically confirmed: bash defers INT/TERM until the foreground child returns, so `_parent_thaw` never runs while the child reads the frozen tree (iter 2).
- Cut-short banner gated correctly: CHECKS_STARTED after engine launch, RUN_COMPLETED after the summary, no genuine runner `exit` between them; set -u safe (iter 1, 2).
- Test genuinely wired into test:shell (not just `bash -n`); each of the three arms fails if its part of the fix is reverted; ARM 1 forces its own symbolic-HEAD worktree so the re-exec path runs even under CI's detached checkout; ARM 3 pairs subject with a real control (iter 1, 2).
- Release-cut path verifiably unchanged (detached HEAD, no FROZEN_RUNNER, untouched else-branch) (iter 1, 2).
