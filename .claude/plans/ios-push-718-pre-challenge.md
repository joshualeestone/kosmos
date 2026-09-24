---
pre_challenge: true
method: challenge-loop
branch: ios-push-718
diff_hash: 97b2dcd4df3cda1ea7f871df1af5fcc268db3c5caf4c2867da63f0e313211b81
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T20:35:44Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 9 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs)
**Fixed:** 3 WARNINGs + 4 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Initial validation (6.0) passed on the first commit (repo suite 8779 tests, 0 fail; subdir audit clean),
so iteration 1 is the first reviewer pass. Swift is outside the repo validation helper, so every
iteration also ran `ios/LogicTests/run.sh` (VERDICT line asserted) and `xcodebuild -target Kosmos`
for iphoneos26.5 and the simulator SDK.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] .github/workflows/ -- nothing in CI runs ios/LogicTests/run.sh --> FIXED (d3007513: new advisory ios.yml runs the suite, asserts the VERDICT line, and builds for the simulator SDK)
- [WARNING] ios/Kosmos/PushRegistrar.swift:83-94 -- a sign-out while a register is in flight can reach the coordinator before the register, leaving the token registered to the signed-out account --> FIXED (d3007513: a register that lands ok with nobody signed in is unregistered again; not when a newer session exists, whose register re-owns the token; tests for both arms)
- [WARNING] ios/Kosmos/PushRegistrar.swift:43,88 -- the owed unregister after a sign-out before the APNs token existed only in memory and was lost on relaunch --> FIXED (d3007513: persisted as a second Keychain item, cleared once the coordinator answers or a new sign-in re-owns the token; relaunch tests)
- [NIT] PushRegistrar.swift:97-107 -- repeat posts during an in-flight register re-send --> FIXED (in-flight pair dedupe, tested)
- [NIT] PushRegistrar.swift:76 -- Keychain rewritten on every repeat post --> FIXED (skip when unchanged, tested)
- [NIT] PushRegistrar.swift:137 -- `status ?? 0` unreachable default --> FIXED (per-outcome arms)
- [NIT] PushNotificationManager.swift:95-98 -- permission denied means never registered, unstated --> FIXED (log line + README note)
- [NIT] plan checkboxes all unchecked --> FIXED (plan updated)

Orchestrator note: during the fix, a mutation run showed one new test caught its defect only by a
trap (out-of-range index) that also swallowed buffered output. Hardened: bounds-safe indexing and a
line-buffered stdout, so a missing request is a counted FAIL and partial output survives a crash.
Ten mutations in total (five original, five for the iteration 1 fixes) each turn the suite red.

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per 6a)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 0
- [NIT] ios/Kosmos/PushBridgeLogic.swift:26-30 -- port normalisation covers only https:443, not http:80; inert because the coordinator origin is https-only and http is refused by the scheme check
The reviewer independently ran ios/LogicTests/run.sh (97/97) and the simulator-SDK build (succeeded).
**Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | .github/workflows/ | BRANCH | No CI runs the iOS logic tests | FIXED | d3007513 |
| 2 | 1 | WARNING | ios/Kosmos/PushRegistrar.swift:83 | BRANCH | Sign-out racing an in-flight register leaves token registered | FIXED | d3007513 |
| 3 | 1 | WARNING | ios/Kosmos/PushRegistrar.swift:43 | BRANCH | Owed unregister lost on relaunch | FIXED | d3007513 |

### NITs (non-blocking, across all iterations)
- [NIT] PushRegistrar.swift:97-107 -- in-flight duplicate registers (iteration 1, fixed)
- [NIT] PushRegistrar.swift:76 -- Keychain write per repeat post (iteration 1, fixed)
- [NIT] PushRegistrar.swift:137 -- unreachable `?? 0` (iteration 1, fixed)
- [NIT] PushNotificationManager.swift:95 -- permission-denied consequence unstated (iteration 1, fixed)
- [NIT] plan file checkboxes stale (iteration 1, fixed)
- [NIT] PushBridgeLogic.swift:26 -- http:80 not normalised; inert, https-only origin (iteration 2, left as is)

### Strengths (across all iterations)
- Origin gate runs before the body is parsed; negative tests for subframe, http, lookalike, sibling and parent domains, other ports, empty host, file URL (iterations 1, 2)
- Runtime aps-environment from the provisioning profile instead of #if DEBUG (iteration 1)
- Keychain ThisDeviceOnly, ephemeral URLSession without cookies or cache, and a positive-controlled test that no log line carries session or token material (iterations 1, 2)
- Weak proxy for the WKScriptMessageHandler plus dismantleUIView removal, avoiding the retain cycle (iterations 1, 2)
- Suite ends in one asserted VERDICT line, and CI greps for it under pipefail (iteration 2)
