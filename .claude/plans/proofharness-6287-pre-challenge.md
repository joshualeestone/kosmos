---
pre_challenge: true
method: challenge-loop
branch: proofharness-6287
diff_hash: 2800be1e02b8642a2859ddcc4fbd8caac01a469382088bc1fa59a9c85a534654
validation: on the tree rebased onto kosmos main, each run alone from the repo root: tools.fedproof-helpers-in-sync-6287 2/2, tools.browser-checks-quiet-4253 7/7, tools.all-node-tests-considered-1934 3/3, comment-deferral, fixture-discipline 20/20; node --check on both harnesses. One-character code mutants in stopPids, ownedAlive and the exit handler each turned the guard red. The harnesses change by two comment lines each, so no proof re-run is owed. The PR's CI is the merge gate.
subdir_audit: passed
timestamp: 2026-10-16T07:59:36Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: no BLOCKER, WARNING or CONVENTION; NITs)
**Total actionable findings:** 0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs (plus NITs)
**Fixed:** all | **Asked:** 0

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] ownedAlive (the orphan sweep) differs only by a comment, yet was left out --> FIXED (guarded; whole-line comments are ignored)
- [WARNING] the module state the helpers use was unguarded --> FIXED (stopping, started, taken, cleaned, cleanedDone, the exit handler, SCREEN)

#### Iteration 2
**Reviewer model:** opus
- [WARNING] seven more state lines were unguarded --> FIXED (finishing, KEEP, LOGS, T0, results, halted, coord)
- [WARNING] identical code is not identical behaviour (BIN, SANDBOX) --> FIXED (named in the test and the plan)
- [WARNING] the "differ on purpose" list was incomplete (error and signal handlers) --> FIXED
- [WARNING] the test said the card explained the decision while the card said the opposite --> FIXED (decision posted on #6287)

#### Iteration 3
**Reviewer model:** sonnet
- No BLOCKER, WARNING or CONVENTION: CONVERGED. Nit taken (the plan's comment-length wording).

### Decided, with reasons (in the plan and on the card)
- A guard instead of the card's proposed extraction: the helpers close over each harness's own state, and extraction means re-proving both harnesses against freshly built relay binaries, for two files.
