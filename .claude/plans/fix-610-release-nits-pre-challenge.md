---
pre_challenge: true
method: challenge-loop
branch: fix-610-release-nits
diff_hash: 8ef41a6c94e00a1271752ceb48b50cdbfb5828d36fcaa4f469e0c75892912a14
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T17:39:16Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 produced zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 3 NITs, 0 BLOCKERs/WARNINGs/CONVENTIONs
**Fixed:** 2 NITs (comment accuracy) | **Deferred:** 1 NIT (out of scope, documented)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] release.sh:125 - the nit-2 comment cited "line-428 replacement"; the full EXIT trap is now at 439 and will drift again. --> FIXED: reworded to not cite a line number.
- [NIT] release-freeze.sh:242 - the nit-3 comment undersold the exec-bit check's scope (it guards every git-executable member, e.g. app/bin/kosmos-report-hook.sh, not just bin/kosmos). --> FIXED: comment now documents the real scope AND records the kosmos-tunnel/kosmos-app carve-out.
- [NIT] release-freeze.sh:210-226 - the two checksum-verified binaries (kosmos-tunnel, kosmos-app) `continue` before the exec-bit check, so the exec-bit failure mode is uncovered for them. --> DEFERRED: out of scope for #610's three recorded nits; they have no tree copy to read a mode from (their identity is the sha), so asserting they are executable is a separate guard. Documented in the nit-3 comment as a known carve-out.

**Converged** - no NEW actionable findings; the three NITs are comment accuracy (two fixed) and one out-of-scope observation (deferred + documented).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | release.sh:125 | stale line-number in nit-2 comment | FIXED | de-referenced |
| 2 | 1 | NIT | release-freeze.sh:242 | nit-3 comment undersold the exec-check scope | FIXED | comment documents real scope + carve-out |
| 3 | 1 | NIT | release-freeze.sh:210-226 | tunnel/app exec-bit uncovered | DEFERRED | out of scope; no tree mode to compare; documented |

### Strengths (from the review)
- All three fixes correct by inspection and by the test run (65/65, 0 failures). nit 1: rc capture is set -euo pipefail-safe, covers the {0,1,2} return set, success/retry preserved, and never feeds a curl-failed partial file to the comparator. nit 2: the signal traps survive the EXIT-trap replacement, convert a signal into a single normal-exit cleanup, and `exit 130/143` makes `_rc=$?` classify as killed with the right signal; the comment correctly explains why `EXIT INT TERM` would be wrong. nit 3: portable `-x` XOR, guarded on tree-file existence, a genuine no-op when both sides are non-exec.
- The nit-3 test genuinely discriminates (without the check, modebad.tgz matches on content and the "was called matching" arm fails), its control (same content + same mode) is meaningful, the red names bin/kosmos, and the fixture is chmod-restored so later tests are unaffected.

### Note (recorded honestly)
nit 2's first rationale wrongly claimed the naive `EXIT INT TERM` "double-fires"; I tried to test that and the control FAILED (measured 1, not 2 - a returning signal trap resumes rather than exits). I corrected the rationale to the true one and deleted the misleading test rather than ship a test whose own control failed. No reliable SIGINT test was addable (no timeout on the build box).
