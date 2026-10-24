---
pre_challenge: true
method: challenge-loop
branch: ownseal-own-7028
diff_hash: 9f36d88e5a391bb266fd2ee996f1712aa2a6229581305b3adf0c20f0110d40ee
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T10:40:05Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind reviewers, each given the code and the plan, not my conclusions.
**Converged:** Yes (iteration 6: no defects; three low notes recorded in the plan)
**Total findings:** 2 BLOCKER-class (round 2 auto-clear trusted the coordinator; round 5 the rejoin never fired on a live connection), 11 SHOULD-FIX, the rest recorded as decided residuals
**Fixed:** every BLOCKER and SHOULD-FIX | **Asked (awaiting user):** 0

The full record of each round, and every decision with what was rejected and the weakest premise, is in
`.claude/plans/ownseal-own-7028.md`.

#### Iteration 1
- [SHOULD-FIX] forged-frame cooldown let a real seal be ignored; deleted-guest lockout loop; `checked` untested -> FIXED (and later superseded)
#### Iteration 2
- [BLOCKER] the forged-seal auto-clear trusted the coordinator -> part 3 DECIDED NOT BUILT; [SHOULD-FIX] a list cached before an Allow dropped the new computer -> FIXED
#### Iteration 3
- [SHOULD-FIX] a dropped own computer could never get back in -> FIXED (ownRejoin)
#### Iteration 4
- [SHOULD-FIX] the rejoin counted time away -> FIXED; test gaps -> FIXED
#### Iteration 5
- [BLOCKER] ticket renewals reset the rejoin clock so it never fired -> FIXED; [SHOULD-FIX] unreadable remove reported success -> FIXED
#### Iteration 6
- no defects

## Validation
- 573 tests across 27 files (every fedseats/fedseal/federation test, server routes, fixture-discipline, the data-root,
  engine.reachable, Windows separator and coupling, brand/name guards, remote step-up): all pass.
- Both browser-check gates (coarse and surface): 0 (no web/ change).
- Mutation: 30+ deliberate breaks of the new code; every one caught except one guard (ownRejoin's epoch check, a
  one-step race no harness here can interleave), recorded.
