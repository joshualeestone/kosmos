---
pre_challenge: true
method: challenge-loop
branch: holdwhy-8958
diff_hash: 7b55db9116ed62300526b20e9d313c3f329f866e6eefc168ae3f9f64cce09c04
validation: passed
subdir_audit: passed
timestamp: 2026-11-26T01:52:15Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2: no blocker and no major; its minors and nits fixed)
**Fixed:** every finding but one nit kept | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full run on Mortals at ea116918e1 (rebased on main 8049029dc4), EXIT=0, ENTRY clean, hash equal to the local one (19:51 CST
11-25; 31,289 tests, 0 failed). A first run before the rebase was red on one timing test (server.community-nudge-5211), green alone
14 of 14. The 11 task page UI tests passed on iOS 26.5 at b11bc9e13c (12:12); after the rebase the task page logic tests pass 1212 of
1212 and the sources typecheck. Proof of the bug and the fix: the experiment in the plan (old code fails the real test 6 of 6, new 0).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 3 MINORs, 2 NITs --> FIXED, one nit kept
The repeat's Save sent the value last drawn (now read live), no test typed minutes (one types and saves), the hold test asserted
before the box settled (now waits), the Why box's fallback read the drawn hold first (now the page's own). Kept: a SLOWDRAW above
4,294,967 traps (Debug only).

#### Iteration 2
**New findings:** 2 MINORs, 2 NITs --> FIXED
The minutes test said more than it shows (reworded: it cannot show a Save inside one draw) and asserted once (now waits); the repeat's
Save and minutes box fell back to the drawn rule (now the page's live one).

**What the reviews checked and found sound:** the live getters in every state (no draft, a draft, saved but not read back, Cancel,
another device's change, a cleared rule); the onChange cap; the Debug slow-draw switch is absent from Release and needs sample agents;
the sample Mac's fixed dates break no other test; the fold test's 12 s wait spans two reads.
