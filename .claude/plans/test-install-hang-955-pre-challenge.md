---
pre_challenge: true
method: challenge-loop
branch: test-install-hang-955
diff_hash: 2e67c021ceeb203f8c495f5afa77b572b140f8b18bcef7c67d73e102b08cf1d6
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T00:17:05Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 returned no BLOCKER/WARNING/CONVENTION; its two NITs are recorded below)
**Total findings:** 8 (0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 7 | **Deferred:** 1 | **Asked (awaiting user):** 0

> Validation note, disclosed: the full suite (`bash tools/run-tests.sh`) was held during the
> 0.6.21 release cut on the fleet's ruling (the suite spawns test-install.sh and re-trips the
> cut guard, kosmos#1796), then run once after RELEASED on the rebased branch; its exit code
> and tally are in the plan's ledger. Iterations 3 and 4 were verified with the small target
> test (`bash tools/test-app-port-selftest.sh`, 10 arms) while the hold stood; the last
> full-suite green inside the loop was iteration 2 (3598 of 3598). The shared validation
> helper routes lockfile-less repos to pnpm and fails closed on this repo tonight (fleet
> bulletin), so the suite was run directly and its exit code read from the log.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] tools/lib/app-port-selftest.sh - the fake-flag control arm started and orphaned the app on every current run, and a naive kill left forked children holding the port --> FIXED: `bounded_run` runs the child in its own process group (perl setpgrp) and kills the group on timeout; the fake-flag arm was dropped for the expected-value check (real flag must return the exact pinned port fast)

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
- [WARNING] tools/test-app-port-selftest.sh - the no-orphan arm was vacuous: the stub exec'd, so the launcher WAS the sleep and nothing could be orphaned --> FIXED: a forked-child stub, so the arm can fail
- [WARNING] tools/test-install.sh - comment and message still described the dropped fake-flag arm --> FIXED: rewritten to expected-value language

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
- [WARNING] tools/test-app-port-selftest.sh - a hardcoded marker could false-FAIL a concurrent cut sharing the temp dir --> FIXED: per-run-unique `$$` markers (and an 11-digit sleep overflow found on the way, kept to 9 digits so BSD sleep does not overflow)
- [WARNING] tools/test-install.sh - a late hung uid tripped `set -e` and aborted the section instead of recording a FAIL --> FIXED: the per-uid call is an if-gated assignment

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] tools/test-app-port-selftest.sh - `wait_gone`'s pgrep pattern was an unanchored prefix --> FIXED: anchored (`"$1\$"`), proven with a control
- [NIT] tools/lib/app-port-selftest.sh - poll granularity (~6s) --> DEFERRED: harmless, matches `wait_for_file`
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/app-port-selftest.sh | fake-flag arm orphans the app; naive kill leaves children | FIXED | process-group kill, expected-value check |
| 2 | 2 | WARNING | tools/test-app-port-selftest.sh | no-orphan arm vacuous (exec) | FIXED | forked-child stub |
| 3 | 2 | WARNING | tools/test-install.sh | stale fake-flag comment/message | FIXED | expected-value wording |
| 4 | 3 | WARNING | tools/test-app-port-selftest.sh | hardcoded marker false-FAILs a concurrent cut | FIXED | unique `$$` markers, 9-digit cap |
| 5 | 3 | WARNING | tools/test-install.sh | set -e abort on a late hung uid | FIXED | if-gated assignment |
| 6 | 4 | NIT | tools/test-app-port-selftest.sh | unanchored pgrep prefix | FIXED | anchored pattern |
| 7 | 4 | NIT | tools/lib/app-port-selftest.sh | poll granularity | DEFERRED | matches wait_for_file |

### NITs (non-blocking, across all iterations)
- [NIT] tools/lib/app-port-selftest.sh - poll granularity ~6s (iteration 4)

### Strengths (across all iterations)
- The expected-value check is cheaper and strictly stronger than a two-arm fake-flag control on a binary that runs the app on an unknown flag (iteration 1)
- Every arm of the small test can fail, including the forked-child no-orphan arm (iteration 2)
- Per-run-unique markers make the test safe beside a concurrent release cut (iteration 3)
