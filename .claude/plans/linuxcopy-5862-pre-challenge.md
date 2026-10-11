---
pre_challenge: true
method: challenge-loop
branch: linuxcopy-5862
diff_hash: 67e4b9d4fb0a1fe1cdf562fb5a6732015ac20591cfc099271b557cfd9e334fe5
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T22:21:56Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3, alternating opus (odd) and sonnet (even).
**Converged:** yes. Iteration 3 (opus) raised NITs only.
**subdir_audit:** no CLAUDE.md file is changed on this branch (`git diff --name-only origin/main...HEAD` lists none), so there is nothing for the audit to check.

**Validation:**
- A full `tools/run-tests.sh` on Mortals at cf36b0f56 came back clean.
  - Hash 67e4b9d4fb0a, base c5b1a6ff.
  - The entry's status is "clean", not "skipped".
  - Node: 19206 tests, 0 fail.
  - The validation log says PASSED for the whole run.
- Every web*.test.js was run locally with the worktree as the cwd: 349 files, 2679/2679.
- render-restart-screen-4343, run headless through queued-heavy: 78 passed. Every earlier run on record shows 72, so the six new [linux] assertions ran.
- Browser-check gates: the coarse gate passes, because a check was updated. The surface gate passes.

#### Iteration 1 (opus)
- [WARNING] The world-switch fallback named `kosmos restart`, but on Linux it is reached only by a board that is not installed (verified in engine/boardrestart.js). Fixed: it now says "stop Kosmos and start it again the way you started it". A cause I first added was removed, because a require failure also reaches it.
- [WARNING] The two worldswReconnect lines said "quit and reopen" everywhere. Linux now gets `kosmos restart` through worldswStuckStep, since only an installed board reaches them. The rest of the class is filed as #5865.
- [NIT] Windows' restartHowText is now pinned in the unit test. Taken.
- [NIT] The offline note also restarts a healthy board when only a tunnel dropped. Kept, and recorded as a decision.

#### Iteration 2 (sonnet)
- [BLOCKER] web.engine-restart-screen-4408's harness lacked onLinux. Fixed, and every web test was then run.
- [NIT] sinceAfter's harness returns before restartHowText. That is unchanged by this branch.

#### Iteration 3 (opus)
- [NIT] Why the offline note and the screen give a board that is not installed the command, while the fallback does not. Recorded as a decision in the plan.
- [NIT] A dev setup where a source board sits beside an install. Not taken.

**Mutants** (each failed its named assertion): each Linux arm switched off; the world-switch arm put back to the command; worldswStuckStep's Linux arm off; a reconnect line hard-coded.
