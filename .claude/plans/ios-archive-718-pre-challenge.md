---
pre_challenge: true
method: challenge-loop
branch: ios-archive-718
diff_hash: 965b36df867172715dbe24a7e557bf198b48fc62cc6d9dfe75adf17bed9c379a
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T07:08:37Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes, iteration 2 raised no new BLOCKER, WARNING or CONVENTION.
**Total findings:** 5 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, 10 NITs
**Fixed:** 5 WARNINGs and 5 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Final validation (6j): `yarn test` passed on 14f3ef97c (validation-log hash 965b36df8671, the
diff this proof hashes), subdir audit passed; run behind `tools/heavy-gate.sh --twice`. The iOS
build itself is proven only by iOS CI on the PR: this Mac has no iOS runtime, so the asset catalog
cannot compile here (measured, both platforms). `ios/tools/test-check-ipa-entitlements.sh` passes
locally, 10 cases, and each failing case was read for its reason.

Note: the initial validation (6.0) was not run separately before iteration 1; the box was held
by a release, and 6j ran the full suite on the final commit.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 8 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/tools/check-ipa-entitlements.sh -- never compares the signing team with Signing.xcconfig --> FIXED (14f3ef97c): team argument, application identifier and com.apple.developer.team-identifier both checked; read with PlistBuddy because plutil treats the dots as a path (the first version refused every correct build, caught by the store-build case); three wrong-team cases added
- [WARNING] ios/tools/archive.sh -- upload key name checked only after archive and export --> FIXED (14f3ef97c)
- [WARNING] ios/tools/archive.sh:40 -- Team ID read breaks on a trailing // comment --> FIXED (14f3ef97c), five spellings tried
- [WARNING] .github/workflows/ios.yml, archive.sh -- `-scheme Kosmos` relies on scheme autocreation --> FIXED (14f3ef97c): shared scheme committed; `xcodebuild -list` shows it
- [WARNING] .github/workflows/ios.yml:48 -- 20-minute timeout with more work --> FIXED (40 minutes)
- [NIT] unsigned test case could pass for the wrong reason --> FIXED (asserts the no-entitlements line)
- [NIT] -h prints the set line --> FIXED; [NIT] --build with no value exits silently --> FIXED; [NIT] locale-dependent case ranges --> FIXED (LC_ALL=C grep); [NIT] deprecated `:-` codesign form --> FIXED (`--xml`)
- [NIT] check-app-assets.sh has no can-fail test; [NIT] altool --upload-app unproven; [NIT] README build heading --> heading FIXED, the other two recorded in the plan's weakest part

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | ios/tools/check-ipa-entitlements.sh:55 | BRANCH | no signing-team check | FIXED | 14f3ef97c |
| 2 | 1 | WARNING | ios/tools/archive.sh:95 | BRANCH | key name checked late | FIXED | 14f3ef97c |
| 3 | 1 | WARNING | ios/tools/archive.sh:40 | BRANCH | Team ID read vs comment | FIXED | 14f3ef97c |
| 4 | 1 | WARNING | .github/workflows/ios.yml:157 | BRANCH | no shared scheme | FIXED | 14f3ef97c |
| 5 | 1 | WARNING | .github/workflows/ios.yml:48 | BRANCH | CI timeout | FIXED | 14f3ef97c |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- CI's unsigned archive step omits -allowProvisioningUpdates, so it is not byte-for-byte archive.sh's command (iteration 2)
- the --build error says "higher than any build already uploaded", which the script cannot check; Apple refuses a repeat (iteration 2)
- check-app-assets.sh's assetutil text match is first proven on CI (iteration 1)
- altool --upload-app has not run; Transporter is the named fallback (iteration 1)

### Strengths (across all iterations)
- The upload sends the exact .ipa that passed the entitlement check.
- The Team ID has one home, Signing.xcconfig, read by Xcode and the script alike.
- Every new check ends in one VERDICT line that CI asserts, and the entitlement check has a fixture suite that shows it failing.
- The catalog icon is byte-identical to assets/Kosmos-1024.png and the launch colour matches UIColor.kosmosNavy.
