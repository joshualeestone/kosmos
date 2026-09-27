---
pre_challenge: true
method: challenge-loop
branch: quarantine-guard-4160
diff_hash: 29b4401322d7a381075b92fa8f61b63e5d2ee508bf1f1718b5f195f4ef3ae05d
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T12:14:58Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** Yes (iteration 12: no findings)
**Total findings:** 5 BLOCKERs, 22 WARNINGs, 1 CONVENTION, 16 NITs (approximate; every one listed per round in the plan)
**Fixed:** all BLOCKERs and WARNINGs; NITs fixed or recorded as residuals | **Deferred:** heuristic residuals listed in the plan | **Asked:** 0

Validation: full suite PASSED on the final code (hash 29b4401322d7): 10,830 node tests, 0 failed; shell suite
green including bc-quarantine: 39 passed. The first full run had failed 4 tools.release-gate.test.js arms
(their sandbox lacked what step 1e reads); fixed, 53/53, then the rerun passed.

### Per-Iteration Breakdown

Reviewers alternated opus (odd rounds) and sonnet (even rounds), each blind to prior findings.

#### Iteration 1 (opus): 0 BLOCKER, 3 WARNING, 2 NIT
- [WARNING] harness failed open if the lib did not load: fixed (declare -F guard, tested)
- [WARNING] scan measured from the first launch (a helper above main): fixed (last non-comment launch)
- [WARNING] a marked quarantine need not print the token: fixed
- [NIT] run log did not count the refusal: fixed (verdict before the log)
- [NIT] release 3b summary hid QUARANTINED lines: fixed
#### Iteration 2 (sonnet): 2 WARNING, 1 NIT, all fixed (case mismatch; comment-line exit; plan count)
#### Iteration 3 (opus): 2 WARNING, 1 CONVENTION, 2 NIT
- [WARNING] an expiry was caught only after the pushed bump: fixed (release.sh step 1e, before the bump)
- [WARNING] the word anywhere in output: narrowed (then revised in rounds 6 and 11)
- CONVENTION header said first launch: fixed; NITs (bash 3.2 empty array, window control): fixed
#### Iteration 4 (sonnet): 2 BLOCKER, 1 NIT
- [BLOCKER] source test and harness read different windows: fixed
- [BLOCKER] step 1e's diagnostic tripped set -e before its message: fixed, and a test now runs the real block
#### Iteration 5 (opus): 5 WARNING, 5 NIT: word order, one source line vs one output line, block-comment lines, multi-line templates, plan text; fixed or recorded as residuals
#### Iteration 6 (sonnet): 1 WARNING, 1 NIT: lower-case "quarantined" is a real moderation status, so the token is upper case only; fixed
#### Iteration 7 (opus): 3 WARNING, 5 NIT: nearest PASS line only; three controls had gone vacuous; fixed; the green-failing heuristic shapes named as residuals
#### Iteration 8 (sonnet): 2 WARNING, 1 NIT: one console call's arguments; */ code; fixed
#### Iteration 9 (opus): 1 WARNING, 1 NIT: macOS awk under a UTF-8 locale died on a bad byte and read as PASS; LC_ALL=C and fail closed; fixed
#### Iteration 10 (sonnet): 1 WARNING: step 1e's diagnostic could mislead; fixed with a test
#### Iteration 11 (opus): 2 WARNING, 2 NIT: requiring PASS let a coloured PASS / PASSED through, so the harness reads the token alone; two boundary tests could not fail; fixed
#### Iteration 12 (sonnet): 0 findings. **Converged.**

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 4 | correctness | browser-checks-quarantine-guard.test.js | source test and harness disagreed | FIXED |
| 2 | 4 | correctness | tools/release.sh | step 1e message lost to set -e | FIXED |
| 3 | 9 | correctness | tools/lib/bc-quarantine.sh | locale error read as PASS | FIXED |
| 4 | 6 | correctness | tools/lib/bc-quarantine.sh | real moderation status would be refused | FIXED |
| 5 | 11 | correctness | tools/lib/bc-quarantine.sh | coloured PASS / PASSED / no PASS read as pass | FIXED |
| 6 | 7 | heuristic | browser-checks-quarantine-guard.test.js | launch in a function above its call; PASS over 6 lines above | DEFERRED (residual, in plan) |

### NITs (non-blocking, across all iterations)
- Residuals recorded in the plan: exitCode=0 + return, bare return, exit(+0), early exits that print no PASS.

### Strengths (across all iterations)
- Real harness, both arms, on main's quarantined check: rc=1 without the override, rc=0 with it printed; before the change it reported PASS rc=0
- Every control proven red-capable by a planted regression
- Source test green on main since #1079's fix; the only hit before that was the real quarantine
