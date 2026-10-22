---
pre_challenge: true
method: challenge-loop
branch: nse-6487
diff_hash: 0f2da4626484880e7ccb2b0f4eeb6d54a6a3e72fc2f07be60e2c47fc139d5e24
validation: passed
subdir_audit: passed
timestamp: 2026-10-22T21:14:59Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (one blind reviewer at a time)
**Converged:** Yes (iteration 3: no BLOCKER or SHOULD-FIX; 2 NITs, both fixed)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 SHOULD-FIX, 4 NITs
- [SHOULD-FIX] NotificationService.swift fetch followed redirects with the gate cookie --> FIXED (d0e9bf611e): refuses redirects, as BoardClient+App.swift NoRedirects
- [SHOULD-FIX] SessionKeychain.swift save fell through on errSecMissingEntitlement --> FIXED (d0e9bf611e): any refusal falls back to no group
- [NIT] the move deleted before it added --> FIXED (d0e9bf611e): add to the shared group first, delete by the old group
- [NIT] WebP avatars never showed --> FIXED (d0e9bf611e): redrawn as PNG
- [NIT] the time limit discarded fetched words --> FIXED (d0e9bf611e)
- [NIT] MARKETING_VERSION set in two places --> FIXED (d0e9bf611e): test-archive-config.sh asserts one value

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 SHOULD-FIX, 3 NITs
- [SHOULD-FIX] words recorded only after the picture fetch --> FIXED (d6537004f2): recorded first; whole-fetch limits 15 s / 8 s
- [NIT] new sign-ins would land the Kosmos+ session in the shared group --> FIXED (d6537004f2): other stores write to the app's own group
- [NIT] a huge picture decoded whole could exhaust the extension's memory --> FIXED (d6537004f2): ImageIO thumbnail, 300 px
- [NIT] message style used raw WebP --> FIXED (d6537004f2)

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 SHOULD-FIX, 2 NITs
- [NIT] answer size checked only after the whole body was read --> FIXED (2e819c5b21's parent): dropped as it streams
- [NIT] the move ran only when the Agents tab opened --> FIXED: SessionKeychain.macSession.load() at launch
**Converged:** no new actionable findings.

### Final validation
- ios/LogicTests/run.sh: VERDICT PASS 512/512 (new phone-notice cases, each with a refusal arm).
- ios/tools/test-archive-config.sh: VERDICT PASS; the same tests against main's archive.sh/export-options.sh FAIL (18 failures), so they can fail.
- Simulator builds (Debug and Release, unsigned): BUILD SUCCEEDED, extension embedded as io.kosmos.app.notice.
- Hand-signed archive + export, KOSMOS_IOS_PROFILE='Kosmos App Store' KOSMOS_IOS_NOTICE_PROFILE='Kosmos Notice App Store', build 990002, NOT uploaded: ARCHIVE and EXPORT SUCCEEDED, check-ipa-entitlements.sh VERDICT PASS (app and extension).
- check-ipa-entitlements.sh controls on an ad-hoc signed app: no shared group in the extension FAILS, no extension FAILS.
- The node suite does not cover ios/ (this diff touches only ios/ and .github/workflows/ios.yml); the iOS CI workflow runs on the PR.
