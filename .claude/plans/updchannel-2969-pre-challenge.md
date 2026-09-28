---
pre_challenge: true
method: challenge-loop
branch: updchannel-2969
diff_hash: 0391f05f48e3e98853c82777b5113cfe0571c29593e5ed04b3280af443ba8588
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T17:00:13Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (reviews 1 and 2 are blind reviews; iterations 3 and 4 are validation passes that each surfaced findings)
**Converged:** Yes (review 2: no BLOCKER, WARNING or CONVENTION; validation then passed)
**Total findings:** 2 WARNINGs, 1 CONVENTION, 5 NITs from review; 3 validation findings
**Fixed:** all WARNINGs, the CONVENTION, the validation findings and 4 NITs | **Deferred:** 1 NIT | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
- [WARNING] engine/update.js: the new comment claimed staging is always at or ahead of prod, but tools/release.sh cuts straight to prod by default and never touches latest-staging.json, so a staging subscriber would sit on "Up to date" past a prod hotfix --> FIXED (commits 3d052067a and 51ab99077): a readable Mac staging look also reads the prod pointer and offers the newer; the installer reads the offer's pointer (installPointer) and is told the subscription separately (KOSMOS_SOURCE_CHANNEL, stamped by install/setup.sh). Test red without it.
- [WARNING] engine/update.test.js read the real machine's source-channel stamp, so it failed on a staging-stamped box (reproduced) --> FIXED: its data root is sandboxed, as is engine.update-poll-1945.test.js; every test file that drives the updater was run under a staging-stamped ambient data root and passed.
- [CONVENTION] server.js (two places) and engine/update.test.js comments made false by this change --> FIXED.
- [NIT] updateChannel ignores the passed env for the stamp --> FIXED (comment).
- [NIT] browser-check header prose quoted the bare sentence --> FIXED.
- [NIT] server.test.js untold-channel arm reads as the current sentence --> FIXED (note).
- [NIT] the Settings verdict names updateChannel() at paint time, not the look's cache.channel --> DEFERRED: they differ only if the stamp or environment changes between a look and a paint.
- [NIT] (the fifth) folded into the CONVENTION fix.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
- No issues found. Checked installPointer against a stale or cross-channel cache, readProdAlongside can only add an offer, prodPublishesRunning keys on the subscription, Windows untouched, old and new setup.sh against old and new boards, the wire-test extraction byte for byte.

#### Iteration 3 (validation)
**Reviewer model:** none (validation helper)
- [BLOCKER] validation: engine.reachable.test.js flagged update.js's new export setRecordedChannel as tested, exported and reachable from nowhere --> FIXED (3e06e472c): excused as a test seam with a checkable reason, like the module's other setters.
- [BLOCKER] validation: the #4273 run-root leak guard found kosmos-updtest and kosmos-poll1945 temp dirs left by the two newly sandboxed files --> FIXED (3e06e472c): both require test-support/tmpscope first; measured before and after, none left.

#### Iteration 4 (validation)
**Reviewer model:** none (validation helper)
- No issues found: node 11260 tests, 0 failed; no leaks; validation PASSED (hash 67d5414172df); subdir audit passed.

#### Iteration 5 (CI, after the PR opened)
**Reviewer model:** none (CI browser-checks, the first live run of the checks this branch changed)
- [BLOCKER] docs/browser-checks/render-updates-stale.js: its control expected a named channel, but its own stub answered /api/update/check with no `channel` field, so the page correctly took the untold-channel arm ("Up to date."); the real endpoint always sends channel --> FIXED (29e907b25): the stub sends channel 'prod' and the control expects "Up to date on the release channel.". render-update-win32-manual.js passed live in the same run.

#### Iteration 6 (validation)
**Reviewer model:** none (validation helper)
- No issues found: node 11260 tests, 0 failed; validation PASSED (hash 0391f05f48e3); subdir audit passed. The changed check runs live again in this PR's CI.

### Final Ledger
| Finding | Status |
|---|---|
| Iteration 1: 2 WARNINGs, 1 CONVENTION, 4 NITs | FIXED |
| Iteration 1: verdict names the live channel, not the look's | DEFERRED |
| Iteration 3: reachable-export and leak findings | FIXED |
| Iteration 5: render-updates-stale stub had no channel | FIXED |

### Notes
- Every new #2969 test was run red with its fix removed (fallback, prod comparison, Settings sentence) and green with it.
- The two live-board browser checks this branch changes could not run on this box (a hand-started board is refused here); they run live in this PR's CI browser-checks job, which is how iteration 5 was found.
