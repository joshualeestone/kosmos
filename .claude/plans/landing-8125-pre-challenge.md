---
pre_challenge: true
method: challenge-loop
branch: landing-8125
diff_hash: ff3b39034f553576f403936a7a002a7a70c838c068aef6a3c22d258a5c30462a
validation: local (app selftest 290; every web*, native-app* file and every test that reads main.swift, 482 files)
subdir_audit: passed
timestamp: 2026-11-06T20:26:08Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 found only a NIT, zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Fixed:** 2 WARNINGs, 1 NIT | **Deferred:** 3 NITs, kept with reasons in the plan | **Asked:** 0

kosmos#8125, a follow-up to #8118 (stacked on reopen-8118, PR #8127). When the Mac app's launch reopen starts a switch that never lands, the launch now counts as a miss at quit, so the 3-launches-in-a-row limit applies to it too.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] native-app/main.swift applicationWillTerminate: a quit after the remote page committed, but before it finished, counted a landed switch as a miss --> FIXED: where the window is (`away`) is read first, and only `neverLanded` counts. Commit c0155e72b9.
- [WARNING] native-app.reopen-8118.test.js: the test could not fail with the forget at the limit removed --> FIXED: the forget block is pinned; a mutant without it fails. Commit c0155e72b9.
- [NIT] with no computer kept, a due landing was still counted --> FIXED. Commit c0155e72b9.
- [NIT] a failed click-started switch ('busy') charges the kept computer one miss --> KEPT (only a failed one costs a miss).
- [NIT] quitMissesAfter's false branch had no real caller --> resolved by the first fix.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] three quick quits in a row while a switch is still loading forget a healthy computer --> KEPT (the plan's decision to count at quit; rare).

### Validation (honest scope)
Local, on c0155e72b9: app selftest 290/290 (swiftc at the macOS 13.5 floor; a mutant that never counts fails both counting rows); 482 test files (web*, native-app*, and every test that reads native-app/main.swift), 4165 run, 0 fail. Not run: the full `yarn test`.

### Note
Stacked on reopen-8118, so diff_hash is over origin/main...HEAD, including #8118's commits. After #8127 rebase-merges and this branch is rebased onto main, recompute diff_hash before the PR. The reviewed change stays the same.

### Weakest premise
That a page which loads at all clears the landing: a page from that computer that loads and then fails counts as landed.
