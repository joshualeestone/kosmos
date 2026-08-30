---
pre_challenge: true
method: challenge-loop
branch: browser-guard-1391
diff_hash: 08993241812eba2a4e7af9bb969f64c4d0d8c56c7dc8425f0eb67c9811529374
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T00:42:12Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero actionable findings)
**Total findings:** 8 (0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 4 NITs) plus 12 STRENGTHs
**Fixed:** 5 | **Deferred:** 3 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] tools/browser-checks.sh (arming) -- no regression coverage; a re-disarm would keep all tests green --> FIXED (efc14b66): added a static assertion that the shipped runner calls the arm; negative-control verified it fails on a re-disarm.
- [WARNING] tools/lib/cut-guard.sh (subtree filter) -- missing `|| true` parity with the single-pid path --> FIXED (efc14b66).
- [CONVENTION] .claude/plans/browser-guard-1391.md -- em dashes violate the project style rule --> FIXED (efc14b66): rewritten with hyphens, 0 remaining.
- [NIT] tools/browser-checks.sh -- a concurrent-run refusal reads as "page checks red"; the reason is in the page log --> DEFERRED: changing release.sh's error surfacing is out of #1391 scope.
- [NIT] tools/lib/cut-guard.sh -- the `KOSMOS_HARNESS_IGNORE_CUT` override name is a mild misnomer for the browser case --> DEFERRED: deliberate and documented (one override name for the operator, matching the cut guard).

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
- [WARNING] tools/lib/cut-guard.sh (ancestry walk) -- a nested descendant whose intermediate ancestor exits mid-walk (reparented to pid 1) can miss `root` and read as a separate run: a self-inflicted false positive --> DEFERRED: bounded (real-path matches are direct children of a live caller, so the walk hits root on the first hop), direction is safe (over-reports, never misses a genuine second run), and a process-group alternative conflicts with the tests' sibling model. NAMED explicitly in-code (committed as a comment in the same iteration).
- [NIT] tools/lib/cut-guard.sh -- the 64-hop cap biases toward refuse --> DEFERRED: astronomically unlikely, refuse direction matches posture.
- [CONVENTION] tools/browser-checks.sh:238,251,350 -- pre-existing em dashes --> DEFERRED: outside this PR's hunks (not introduced here); a follow-up sweep.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** -- no new actionable findings. Both NITs (documentation accuracy) fixed as final polish:
- [NIT] tools/lib/cut-guard.sh -- the `|| true` comment claimed the loop exits non-zero on EOF; the loop actually returns 0 (a while loop's status is its last body command) --> FIXED (e3cb768b): comment corrected; guard kept as defensive parity.
- [NIT] .claude/plans/browser-guard-1391.md -- "7/7" cut-guard count is stale --> FIXED (e3cb768b): 10/10, 0 failures.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | browser-checks.sh (arm) | no arming regression coverage | FIXED | efc14b66 |
| 2 | 1 | WARNING | cut-guard.sh:127 | missing `|| true` parity | FIXED | efc14b66 |
| 3 | 1 | CONVENTION | plan file | em dashes | FIXED | efc14b66 |
| 4 | 1 | NIT | browser-checks.sh | refusal reads as page-check failure | DEFERRED | reason is in the page log; out of scope |
| 5 | 1 | NIT | cut-guard.sh:130,134 | IGNORE_CUT misnomer | DEFERRED | deliberate, documented |
| 6 | 2 | WARNING | cut-guard.sh:19-28 | reparenting mid-walk false positive | DEFERRED | bounded + safe direction; named in-code (iter 2 commit) |
| 7 | 2 | NIT | cut-guard.sh:25 | 64-hop cap refuse bias | DEFERRED | unlikely; refuse matches posture |
| 8 | 2 | CONVENTION | browser-checks.sh:238,251,350 | pre-existing em dashes | DEFERRED | outside this PR's hunks |
| 9 | 3 | NIT | cut-guard.sh (`|| true` comment) | inaccurate mechanism | FIXED | e3cb768b |
| 10 | 3 | NIT | plan file | stale cut-guard count | FIXED | e3cb768b |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, across all iterations)
- browser-checks.sh: a concurrent-run refusal reads as a page-check failure (reason in the page log). (iter 1)
- cut-guard.sh: `KOSMOS_HARNESS_IGNORE_CUT` is a mild misnomer for the browser case. (iter 1)
- cut-guard.sh: the 64-hop cap silently biases toward refuse. (iter 2)
- browser-checks.sh:238/251/350: pre-existing em dashes to sweep in a follow-up. (iter 2)

### Strengths (across all iterations)
- The subtree exclusion is in the safe direction by construction: it can only over-report (refuse), never miss a genuinely separate run (a separate run is never a descendant of self).
- Root-cause analysis is correct and reproduced deterministically: pgrep never lists its ancestor (single-pid exclusion was dead code) + argv-inheriting subshells are the caller's own descendants.
- Re-arming is safe for a normal cut (guard sits early, self resolves to the page-layer pid, own machinery is dropped by the subtree walk); verified release.sh does not export the override, so the guard actually arms.
- Tests are discriminating and deterministic without Playwright: the descendant test fails under the old single-pid code; the real-path control is a delta robust to a colleague's concurrent run; the arm-presence grep is a genuine re-disarm regression guard (negative-control verified).
- Clean scoping: the sibling cut guard is left unchanged with an accurate in-code rationale and the shared helper factored for a focused follow-up.
- The one false-positive residual (reparenting mid-walk) is explicitly named, bounded, and its safe direction argued in-code.
