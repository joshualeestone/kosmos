---
pre_challenge: true
method: challenge-loop
branch: iosteam-4089
diff_hash: beb043b7a7a3e8ba9ff117fd668f055d6dd46a468ead74d8ee605b2198f658a2
validation: Mortals full validation CLEAN at 592044609 (2026-10-13T01:21:20Z; node 19665 tests, 19422 pass, 0 fail, 0 cancelled, 243 skipped; shell 230/230). Mortals hash e6a103438f4d is the SAME diff at core.abbrev=9; locally git abbreviates at 10, giving this hash (measured: git -c core.abbrev=9 diff 6b9f06bd1 HEAD | shasum hashes to e6a103438f4d, abbrev 10 to beb043b7a7a3; see #6002).
subdir_audit: passed
timestamp: 2026-10-13T01:21:44Z
iterations: 20
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 20 blind reviews, Opus on odd iterations and Sonnet on even.
**Converged:** Yes, at iteration 20 (Sonnet): 0 blocker, 0 warning.
**Hand-written:** from the branch's review ledger, one line per iteration, kept as the loop ran.
**Tests at convergence:** ios/tools/test-archive-config.sh 13 cases pass; test-check-ipa-entitlements 14 pass; tools/test-cut-sign-preflight.sh 46 pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** Opus (blind)
[WARNING] docs stale (README, archive header, go-live Step 1). FIXED.

#### Iteration 2
**Reviewer model:** Sonnet (blind)
[BLOCKER] the cut-sign sweep forbids the Stone team literal. FIXED: an exception for ios/Signing.xcconfig only while it builds the preview id.

#### Iteration 3
**Reviewer model:** Opus (blind)
[BLOCKER] an App Store app transfer is impossible for an app never released (Apple's App Transfer Criteria, verbatim: "The app must have at least one version that was released to the App Store"). The decision changed to option A, an interim preview bundle id, by Splinter at 17:11.

#### Iteration 4
**Reviewer model:** Sonnet (blind)
[WARNING] push 400 handling verified (it only logs); device builds provision. FIXED in the docs.

#### Iteration 5
**Reviewer model:** Opus (blind)
[WARNING] a fixture redirect was commented out. FIXED.

#### Iteration 6
**Reviewer model:** Sonnet (blind)
[WARNING] an unverified retry claim (the author's own). DELETED.

#### Iteration 7
**Reviewer model:** Opus (blind)
[WARNING] the sweep exception was keyed on the lib's team. FIXED (later rekeyed on the preview id).

#### Iteration 8
**Reviewer model:** Sonnet (blind)
No actionable findings. A Swift fallback was deferred: unreachable.

#### Iteration 9
**Reviewer model:** Opus (blind)
[WARNING] the Mac switch was coupled to the iOS move and one arm was untested. FIXED: a preview-keyed rule, both arms tested.

#### Iteration 10
**Reviewer model:** Sonnet (blind)
[WARNING] the failure message. FIXED.

#### Iteration 11
**Reviewer model:** Opus (blind)
[WARNING] push docs disagreed with the preview build (header, checklist, dev builds). FIXED.

#### Iteration 12
**Reviewer model:** Sonnet (blind)
[WARNING] coordinator claims were uncited. FIXED: cited kosmos-relay apns.rs:284.

#### Iteration 13
**Reviewer model:** Opus (blind)
[WARNING] archive.sh did not refuse io.kosmos.app under Stone. FIXED: the refusal, a --check-config mode, ios/tools/test-archive-config.sh, and CI.

#### Iteration 14
**Reviewer model:** Sonnet (blind)
[WARNING] the KOSMOS_IOS_XCCONFIG seam was honoured on a real archive. FIXED: refused on a real run.

#### Iteration 15
**Reviewer model:** Opus (blind)
[WARNING] the pbxproj or environment could override the checked values. FIXED: team and bundle passed on the xcodebuild command line.

#### Iteration 16
**Reviewer model:** Sonnet (blind)
[WARNING] the docs overclaimed (the refusal is script-only). FIXED.

#### Iteration 17
**Reviewer model:** Opus (blind)
[WARNING] the override advice was wrong (the author's own), and the pbxproj literal was unguarded. FIXED.

#### Iteration 18
**Reviewer model:** Sonnet (blind)
[WARNING] a duplicate key was joined. FIXED: each key exactly once.

#### Iteration 19
**Reviewer model:** Opus (blind)
[WARNING] a missing key was silent, and the sweep ignored a conditional line. FIXED.

#### Iteration 20
**Reviewer model:** Sonnet (blind)
No issues found: 0 blocker, 0 warning. CONVERGED.
