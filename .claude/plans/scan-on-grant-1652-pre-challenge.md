---
pre_challenge: true
method: challenge-loop
branch: scan-on-grant-1652
diff_hash: b54b9bda4ded418fb58e574682efb54da0784fef67fe39631aa0b600fc1c9cfc
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T18:45:53Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found only a NIT that deduplicates to a prior DEFERRED entry)
**Total findings:** 5 (0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 3 NITs; + many STRENGTHs)
**Fixed:** 3 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
- [CONVENTION] .claude/plans/ - no plan file for the branch --> FIXED (commit 3ca1f29a, plan file added)
- [NIT] render-firstrun-scan-on-grant-1652.js - spawn/launch outside the try + no top-level catch, so a launch/spawn throw crashes with no quotable line and reds the gate with "(no FAIL line)" (#1864 class) --> FIXED (commit 1f9e942f, single-line top-level catch + reason-grep count bumps)
- [NIT] web/index.html frScanAgents - a stale-generation invocation still issues both fetches before the guard --> DEFERRED (harmless: import scan only fires on a positive grant where the walk is authorized; the generation guard correctly discards the stale result; a mid-function guard adds complexity for a rare abandoned call)

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 0 NITs
**Duplicates of prior findings (confirmed resolved):** 0
- [CONVENTION] .claude/plans/scan-on-grant-1652.md - recorded a stale reason-grep count (57->58) written before iteration 1 added the top-level catch --> FIXED (commit b5049f69: corrected to EXPECTED_SITES 57->59, EXPECTED_CATCH_SITES 34->35)

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings:** 1 (the double-fetch NIT deduplicates to iteration 1's DEFERRED entry; the reviewer stated "No action needed")
**Converged** - no new actionable findings; 6 STRENGTHs confirming the no-ambush grant gate, generation guard, response shape, non-vacuous browser-check, exact reason-grep counts, and no regressions.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | No plan file for branch | FIXED | 3ca1f29a |
| 2 | 1 | NIT | docs/browser-checks/render-firstrun-scan-on-grant-1652.js | Launch/spawn throw had no quotable line (no top-level catch) | FIXED | 1f9e942f |
| 3 | 1 | NIT | web/index.html:~37837 | Stale-generation invocation issues both fetches before the guard | DEFERRED | Harmless; guard discards stale result; import scan gated on positive grant |
| 4 | 2 | CONVENTION | .claude/plans/scan-on-grant-1652.md:39 | Stale reason-grep count in plan | FIXED | b5049f69 |
| 5 | 3 | NIT | web/index.html:~37860 | Two sequential awaits => extra round-trip on concurrent polls | DEFERRED (dup of #3) | Same concern as #3; reviewer: no action needed |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] frScanAgents double-fetch on stale/concurrent invocations (iterations 1 and 3) - harmless, deferred.

### Strengths (across all iterations)
- The grant gate is strict and fail-safe: `full = !!(gr && gr.checkable === true && gr.granted === true)`; every other outcome (throw, non-ok, granted:false, checkable:false, missing fields, stale) falls to the bare TCC-free scan, so #2125's fresh-install permission ambush cannot be reintroduced. (iterations 1, 2, 3)
- The browser-check is non-vacuous: which-route assertions via server-side route-hit counters; would red on origin/main; 7/7 green with a `ran < 7` floor. (iterations 1, 2, 3)
- Generation guard preserved across the added await: the single `mine !== FR_SCAN_GEN` check sits after both fetches and before the only FR_SCAN write. (iterations 1, 2, 3)
- Response-shape assumption verified server-side: both scan routes carry `candidates`; error paths fail safe. (iterations 2, 3)
- Reason-grep count bumps exact (EXPECTED_SITES 59, EXPECTED_CATCH_SITES 35), independently counted. (iterations 2, 3)
- No private vocabulary: reuses frScanOffer -> frPaintScan and the `candidates` shape. (iteration 2)
