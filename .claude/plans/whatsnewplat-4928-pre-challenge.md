---
pre_challenge: true
method: challenge-loop
branch: whatsnewplat-4928
diff_hash: 954c2366d7df704ac3dee7dc60d4c5070cd90f696eaaf8311ba73dc6de9edd50
validation: focused at head 0e99ae30b on origin/main b991f06e6: every test that reads whatsnew, whats-new, build-kosmos-windows, releasing.md or windows/RELEASING.md, plus fixture-discipline, no-brand-refs-1881, no-name-refs-3071 (22 files, 766 run, 0 failed); both browser-check gates exit 0 (the coarse gate on its trailer: one comment line in web/index.html); reverting the "also" match, the not-twice rule, the build's stop, or swapping its opt-out each fails a test (measured)
subdir_audit: passed
timestamp: 2026-10-02T01:24:51Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 3 WARNINGs, 2 CONVENTIONs and 10 NITs across the rounds (0 BLOCKERs)
**Fixed:** all WARNINGs and CONVENTIONs, 6 NITs | **Accepted:** 4 NITs | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- Confirmed: Windows is cut from the Windows PC (tools/windows/RELEASING.md) on side branches (win-release-0.7.12/13), and the build reads its version from the staged package.json, so the check sits where the number is fixed.
- [WARNING] the Windows runbook did not mention the file, "also" or the opt-out -> FIXED (RELEASING.md step 1; the refusal says COMMIT it on the release branch)
- [WARNING] "also" could open the same window twice (0.7.13, then 0.7.16) -> FIXED (seen-version.json records highlightsFor; the board does not reopen the same words)
- [WARNING] a check that could not run was reported as "add it to also" -> FIXED (exit 3 vs any other)
- [CONVENTION] the build test was a source pin that could not catch warn-only or a swapped opt-out -> FIXED (the block is run under bash against a staged file)
- [CONVENTION] a malformed "also" silently removes both windows -> FIXED (documented as fail closed; the cut's check refuses it first)
- [NIT] the versions link, the temp path in the message, the opt-out note -> one FIXED (opt-out note), two accepted

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the runbook said not to add a number the build then requires -> FIXED (add it always; the board does not reopen the words)
- [NIT] key() parsed the file twice -> FIXED (readFull, one parse); stale comments -> FIXED; the build test now runs under set -euo pipefail -> FIXED; the keep-previous record -> PINNED by a test

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (accepted: highlightsFor carried forward cannot meet a reused main version; duplicates in "also" are harmless)
**Converged** - no new actionable findings.
