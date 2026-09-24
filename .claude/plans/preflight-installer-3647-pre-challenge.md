---
pre_challenge: true
method: challenge-loop
branch: preflight-installer-3647
diff_hash: 59ce3a64a7fafa32a91ded52f79c50c3596d78e519f45f474f422732d26298fa
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T23:19:50Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes
**Total findings:** 30 (1 BLOCKER, 7 WARNINGs, 2 CONVENTIONs, 20 NITs)
**Fixed:** 22 | **Deferred:** 8 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-cut-sign-preflight.sh - the new arms inherited an operator's exported KOSMOS_INSTALLER_CERT --> FIXED (unset in the harness)
- [WARNING] tools/lib/cut-sign-preflight.sh - the seam pass read like a real probe --> FIXED ("PASSED THROUGH ... not probed" wording)
- [NIT] header comment wording --> FIXED
- [NIT] docs/releasing.md 1c paragraph missing --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] tools/test-cut-sign-preflight.sh - no arm for a notary path that resolves but is unreadable --> FIXED (sm_badpath arm)
- [NIT] accessor stderr discarded on refusal --> FIXED (printed indented)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/test-cut-sign-preflight.sh - a SHA-1 KOSMOS_INSTALLER_CERT arm had no wrong-hash control --> FIXED (FFFFFFFFFF control)
- [NIT] release.sh 1c comment stale --> FIXED
- [NIT] plan wording --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/lib/cut-sign-preflight.sh - substring match cannot detect an ambiguous Installer identity --> DEFERRED: same as 3c's own check; named in the plan and header comment
- [NIT] docs/releasing.md:38 read as conditional --> FIXED
- [NIT] docs wrap width --> FIXED
- [NIT] no `command -v` guard for the seams --> DEFERRED: a missing binary now reports as a failure with its error (iteration 5)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-cut-sign-preflight.sh:33 - stubs ignored their args, so dropping `-v` (admits expired identities) stayed green --> FIXED (stubs answer only `find-identity -v`; red-checked: 6 arms red)
- [CONVENTION] tools/lib/cut-sign-preflight.sh:41 - a leftover exported seam passes a real cut as "not probed" --> DEFERRED: same pre-existing pattern as KOSMOS_CODESIGN_BIN; named in the header comment
- [NIT] stops at the first missing credential --> FIXED (both reported)
- [NIT] a failing `security` read as "not in keychains" --> FIXED (reports FAILED rc + stderr)
- [NIT] a directory passed as the key --> FIXED (`-f`; red-checked)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] tools.release-gate.test.js - runs real release.sh with an empty HOME; the new checks refused and 3 arms that must reach step 2 went red (reproduced 23/26) --> FIXED (stand-in scripts; 26/26)
- [WARNING] tools/lib/cut-sign-preflight.sh:43 - substring match can pass a truncated override --> DEFERRED: parity with 3c `grep -qF` and productsign's own partial-name match; an exact match would refuse overrides 3c accepts; named in the plan
- [NIT] a matching identity accepted despite a non-zero `security` exit --> FIXED (`case "$src:$ids"`; red-checked)
- [NIT] key accessor exit code discarded --> FIXED (rc printed)
- [NIT] shared temp file cleaned only at function end --> DEFERRED: no early return; removed on every path

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] tools/test-cut-sign-preflight.sh:186 - pass floor 38 with 42 arms --> FIXED (floor 42)
- [NIT] tools.release-gate.test.js:49 - stub dir never removed --> FIXED (test.after rmSync)
- [NIT] tools/lib/cut-sign-preflight.sh:45 - "not probed" keyed on var being set, not basename --> FIXED (basename, as codesign)
- [NIT] plan's stale "rebase once #3652 merges" --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-cut-sign-preflight.sh | BRANCH | inherited operator override | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | tools/lib/cut-sign-preflight.sh | BRANCH | seam pass read as real | FIXED | iteration 1 commit |
| 3 | 2 | WARNING | tools/test-cut-sign-preflight.sh | BRANCH | no unreadable-path arm | FIXED | 02378f39 |
| 4 | 3 | WARNING | tools/test-cut-sign-preflight.sh | SELF | no wrong-SHA-1 control | FIXED | 84d94524 |
| 5 | 4 | WARNING | tools/lib/cut-sign-preflight.sh | BRANCH | ambiguous identity undetected | DEFERRED | parity with 3c; named |
| 6 | 5 | WARNING | tools/test-cut-sign-preflight.sh:33 | BRANCH | `-v` untested | FIXED | iteration 5 commit |
| 7 | 5 | CONVENTION | tools/lib/cut-sign-preflight.sh:41 | BRANCH | leftover seam passes real cut | DEFERRED | pre-existing codesign pattern; named |
| 8 | 6 | BLOCKER | tools.release-gate.test.js:422 | BRANCH | sandbox arms red | FIXED | cd441089 |
| 9 | 6 | WARNING | tools/lib/cut-sign-preflight.sh:43 | BRANCH | substring override match | DEFERRED | parity with 3c/productsign; named |
| 10 | 7 | WARNING | tools/test-cut-sign-preflight.sh:186 | SELF | floor below arm count | FIXED | f4a0926a |

### NITs (non-blocking, across all iterations)
- [NIT] tools.release-gate.test.js:53 - the stand-in named `security` gets the real-probe wording in test output (iteration 8) - DEFERRED: output only, nothing asserts it
- [NIT] presence, not usability, is checked (iteration 8) - DEFERRED: named in the plan's Rejected section
- [NIT] no test of the unseamed default path for the two new checks (iteration 8) - DEFERRED: exercised by hand by the reviewer, behaved correctly
- (fixed NITs are listed per iteration above)

### Strengths (across all iterations)
- Every new refusal arm was proven red against a mutated scratch copy, with an unmodified copy as a control (iterations 5, 6)
- Same variable, default, match and accessor as step 3c, so 1c cannot drift from what 3c actually needs (iteration 7)
- The one whole-suite effect (release-gate sandbox) was found and fixed before PR; full yarn test 8822/0 on the final HEAD
