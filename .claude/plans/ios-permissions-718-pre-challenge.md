---
pre_challenge: true
method: challenge-loop
branch: ios-permissions-718
diff_hash: aa656b8aa6a024069344fae470b4d37afa2544563f2e5603d3b75f851ed0f3a8
validation: passed (full kosmos sequence on 92742d32: 9079 tests, 0 failed)
subdir_audit: passed
timestamp: 2026-09-25T06:08:06Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (reviewer models: opus, sonnet, opus, sonnet)
**Converged:** Yes, at iteration 4 on HEAD 92742d32 (NITs only)
**Total findings:** 4 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, plus NITs)
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0

Iterations 1 to 3 ran while this Mac was reserved for release 0.6.94, so those reviewers read
only; the builds and checks below ran after the reservation cleared.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] .github/workflows/ios.yml : the check covered only the Debug build, while the store build is Release and the strings are set per configuration --> FIXED (6b787272: CI builds Release too and checks both)
- NITs taken: doc heading; iPhone-only apps still run on iPad in a scaled window; the dead iPad orientation setting removed; the microphone sentence covers project attachments.

#### Iteration 2 (sonnet)
- [WARNING] .github/workflows/ios.yml : a second build against the 20-minute job timeout --> FIXED (05697ba2: reasoned in the plan; the whole job took 34 s on its last run)
- [WARNING] .github/workflows/ios.yml : the simulator build paths were assumed, not verified --> FIXED (92742d32: measured, see below)

#### Iteration 3 (opus)
- [WARNING] .claude/plans/ios-permissions-718.md : the plan stated the path check as done before it was --> FIXED (92742d32: the plan now records the measured result)
- NITs taken: the CI header says what green certifies; Face ID in the per-feature sentence; the entitlement check runs on the app inside the unzipped .ipa; the doc heading.

#### Iteration 4 (sonnet)
NITs only (plan filename convention drift shared by most plans in the repo; a redundant pipefail matching the file's style). **Converged.**

### Measured on this Mac (2026-09-25, after the release reservation cleared)
- Debug and Release simulator builds succeeded and wrote `ios/build/<Config>-iphonesimulator/Kosmos.app`.
- `ios/tools/check-usage-strings.sh` passed on both apps (four strings each).
- The Release app's `UIDeviceFamily` is `[1]`; no iPad orientation key.
- Negative controls on a copy of the Release Info.plist: camera key removed, exit 1; microphone value emptied, exit 1; no file, exit 2.
- LogicTests 223/223 (no Swift changed).

### Strengths (across iterations)
- The keys match what the six board file inputs and the default long-press menu can do; no key is missing and the read-library key is rightly absent
- The check reads the built app, not the project file, for both configurations, and cannot read green on a missing file
