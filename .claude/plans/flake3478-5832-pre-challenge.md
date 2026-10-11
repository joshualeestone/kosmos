---
pre_challenge: true
method: challenge-loop
branch: flake3478-5832
diff_hash: e309a4c12b56a331420896273c35b4d560b86947be80bb2292c55dcb3178457b
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T11:05:38Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (reviewer model: opus)
**Converged:** Yes. Iteration 1 found 0 BLOCKERs, 0 WARNINGs and 0 CONVENTIONs, plus 3 NITs.
**Fixed / Deferred / Asked:** 0 / 0 / 0. The NITs are listed below, not taken.
**Validation:** full tools/run-tests.sh on Mortals at aea497143 is clean: hash e309a4c12b56, base 12f219984. The node suite ran 19051 tests: 18808 pass, 0 fail. The shell suite passed.

**Control for the fix itself** (20x CPU throttle, aimed with KOSMOS_BC_CPU_THROTTLE, on this Mac, headless; details in the plan):
- Old check: 7 of 12 runs failed at the "Finish signing in" click. That is CI's symptom, "element is not visible".
- An earlier throttle that slowed the whole run failed on the first-run overlay instead. It was discarded as the wrong red.
- First fix attempt ("registers since the flip"): 6 of 6 failed in straight-session. Replaced.
- Final fix: 6 of 6 passed at 20x and 2 of 2 passed unthrottled, 173 PASS each.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [STRENGTH] The stated cause is in the code. paintPlus runs on the 5 s tick (web/index.html:24140), and once /api/remote is enrolled it hides state 2 (:48132).
- [STRENGTH] route.fallback() reaches the openPlusState1 handler, because the unroute was removed. The repo already uses the same pattern (mobile-shots.js:175, render-import-name-4962.js:84).
- [STRENGTH] Every scenario still reaches its expected state:
  - existing-2fa, enrol-2fa: the flag is set before fulfill, so the post-register paintPlus reads enrolled.
  - straight-session: registers itself before the new route.
  - enrol-2fa-sms: the refusal sets nothing, which also closes the same race on its second path.
  - The flag is per page.
- [STRENGTH] The check is stricter than before. A wizard that never registers, or is only refused, can no longer reach the "done" assertions.
**Converged:** no new actionable findings.

### NITs (non-blocking, not taken)
- :534 is not from this change. The explicit paintPlus() before waitForSelector('#plus-flow') means the done assertions would also pass without the wizard's own post-register paintPlus. The change does not make this worse.
- :497 route.fallback() is not awaited. This matches the file's existing unawaited route.fulfill calls.
- In straight-session the throttle starts after the only register, so it aims at nothing in that scenario. Harmless.
