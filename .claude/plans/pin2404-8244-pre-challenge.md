---
pre_challenge: true
method: challenge-loop
branch: pin2404-8244
diff_hash: 15b0b180950feb76dee10c8ea9ff107d4c62d30e01855bea9829ec03e7f73f49
validation: passed
subdir_audit: passed
timestamp: 2026-11-08T13:38:13Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 15 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 12 NITs)
**Fixed:** 3 WARNINGs and most NITs | **Deferred:** 0 | **Asked:** 0

Final validation: full suite, 28102 tests, 0 failures (validation-log hash 15b0b180950f). The tests that read the
workflow: 5 JS files (168 tests) and 8 shell tests pass; tools/test-ci-runner-route-5488.sh fails against origin/main's
workflow at the runs-on pin.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
**Self-generated:** 0
- [WARNING] tools/test-ci-created-url-6742.sh:44 — comment still said the shards run on ubuntu-latest --> FIXED (4213f0e3ce)
- [NIT] test.yml comments naming ubuntu-latest for the shards; a long line; the mechanism stated as settled --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
**Self-generated:** 1 (iteration 1 added "then ubuntu-24.04" to a measurement note: unmeasured)
- [WARNING] tools/shell-macos-only.txt:3 — an unmeasured claim --> FIXED (reverted, the file is main's again, c040766e8c)
- [WARNING] .github/workflows/linux.yml:1-2 and test.yml:234 — still said the shards run on ubuntu-latest --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-ci-created-url-6742.sh | BRANCH | stale runner comment | FIXED | 4213f0e3ce |
| 2 | 2 | WARNING | tools/shell-macos-only.txt | SELF | unmeasured claim | FIXED | c040766e8c |
| 3 | 2 | WARNING | .github/workflows/linux.yml, test.yml | BRANCH | stale runner comments | FIXED | c040766e8c |

### NITs (iteration 3, left)
- the "moved to 26.04 on 11-08" date is when this repo saw it, not when GitHub moved it
- one rewrapped comment line is long
- the node lane (linux.yml) stays on ubuntu-latest, now 26.04; worth noting in step 2's measurement

### Strengths
- Every path that places a Linux shell shard is pinned (scope s1/s2, the suite runs-on fallback, the log line); self-hosted routing unchanged
- The route test pins the new value three ways and fails against the old workflow
