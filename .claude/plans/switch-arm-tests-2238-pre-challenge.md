---
pre_challenge: true
method: challenge-loop
branch: switch-arm-tests-2238
diff_hash: 0d2fd9f673b44583c95657fbe516b2f1dbccd9a557458888c032740bc3c4d3b9
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T19:30:32Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 | **Converged:** Yes (iteration 2 returned zero BLOCKER/WARNING/CONVENTION).
**Total findings:** 1 CONVENTION, 4 NITs. **Fixed:** 4 | **Deferred:** 1 | **Asked:** 0.

kosmos#2238 insurance: route-level coverage for POST /api/worlds/active's restart arms, which ride Josh's fresh-install re-test blind (canSelfRestart is always false on the shared box). One new test file (server.switch-arms-2238.test.js) mocks boardrestart.canSelfRestart + selfRestart to drive all three arms with no real launchctl stop. 6.0 + 6j full suite green (4929/4929).

### Per-Iteration Breakdown

#### 6.0 baseline
Full suite green (4929/0) with the new test included.

#### Iteration 1
**New:** 1 CONVENTION, 2 NITs.
- [CONVENTION] the isolation comment claimed --test-isolation=process but run-tests.sh does not pass it --> FIXED: corrected to credit the test.after restore (not a runner flag) as the guarantee.
- [NIT] the fired-restart proof used a fixed 700ms-vs-500ms margin (loaded-CI flake) --> FIXED: poll-until-fired (waitUntil, 3s deadline); kept the synchronous-not-before assertion.
- [NIT] no r.body.world.id assertion --> FIXED: added it.

#### Iteration 2 -- CONVERGED
**New:** 0 actionable. 5 STRENGTHs (the timing pair is non-vacuous; the mock intercept is leak-safe + restored; the no-op exercises the real isNoop branch and cannot pass for the wrong reason; the three arms pin the two booleans to distinct sources and cross-verify bootedWorld at runtime; waitUntil is robust). 2 NITs:
- [NIT] the per-root temp dirs leaked (only SANDBOX was cleaned) --> FIXED: tracked + removed in test.after.
- [NIT] the negative arms use a fixed wait --> DEFERRED: a fixed wait is the correct pattern for asserting ABSENCE of a fire (nothing to poll-until; 700ms > the 500ms timer gives a mis-scheduled fire its chance).

### Strengths
The fired-restart proof reliably distinguishes fires-synchronously / never-fires / fires-after; the no-op arm adversarially sets canRestart=true to prove the short-circuit; the mock drives every arm without a real launchctl stop; originals restored.
