---
pre_challenge: true
method: challenge-loop
branch: cut-rerun-2006
diff_hash: 8e82a8edb5da224fa35a51a16cb9aebf1be7213a2b502c634508125ca9a17581
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T13:22:30Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind-review passes (plus the initial targeted validation)
**Converged:** Yes (iteration 4 returned zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 3 WARNINGs, 8 NITs, 0 BLOCKERs
**Fixed:** all 3 WARNINGs + all NITs | **Deferred:** 0 | **Asked:** 0

This loop earned its length: each of the first three passes found a real issue the
priors missed, all in the completeness/safety logic of a change whose whole job is to
decide when a red cut is safe to wave through.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] cut-rerun-guard.sh -- the safety rests on log-parsing being COMPLETE; a real failure in an unparsed shape alongside a dismissable one could false-green. --> FIXED (124b6766): added a COMPLETENESS cross-check (node's aggregate `ℹ fail N` vs the count of `test at` lines; abort on no tally, fail 0, or fewer test-at lines than N).
- [NIT] a fail-0 later-stage red with a stray `test at` -> now a handled abort case. --> FIXED.
- [NIT] the rerun bypasses run-tests.sh's TMPDIR/coverage harness -> documented (a test needing it stays red -> abort, safe). --> FIXED.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 NIT
- [WARNING] cut-rerun-guard.sh:51 -- the `fail_count` assignment lacked the `|| true` its sibling had, so the header's errexit-safety claim was false (masked only by the sole caller's `if`-wrapper); a future direct caller under set -e would abort before narrating. --> FIXED (46cb0ccc): added `|| true`.
- [NIT] the test ran under set -uo (no -e), never exercising the errexit context. --> FIXED: added a direct-caller set -euo pipefail regression guard; verified it goes RED if the `|| true` is removed.
- Also this pass: made the RUNNER SCOPE explicit (step 3 node only; step 3b browser + external load carded as #2017, corrected there to the real cause -- an IO-stress harness saturating fseventsd, not Playwright sessions).

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] cut-rerun-guard.sh -- the completeness check counted the BROAD `^test at ` while extraction used the NARROW `^test at [^ ]+\.test\.js`, so a failure whose `test at` names a non-.test.js path (a test registered in a required helper) inflated the count to meet `fail_count` while being dropped from the rerun set -- a false-green if it coexisted with a dismissable .test.js failure. --> FIXED (e42d09bc): both patterns now use the narrow `\.test\.js` anchor. Added a control (`log_helper`) verified RED with the broad grep, GREEN with the narrow.
- [NIT] the errexit test only reached the earliest branch -> added a deep set -e test reaching the rerun loop.
- [NIT] the incomplete-parse control did not test the pattern-mismatch shape -> now covered by `log_helper`.

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** -- 4 STRENGTHs confirmed no false-GREEN path exists (verified empirically: node 26.8.1 emits the spec reporter to a non-TTY for both failure shapes and a single aggregate `ℹ fail`), the completeness cross-check closes the incomplete-parse hole, the node-before-shell ordering holds, and errexit safety is real. NITs applied (a259944e): defensive `--` on the rerun; +2 test assertions (multi-test dedup dismiss; fail>0 with zero parseable files abort); plan assertion count 11 -> 20.

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | WARNING | incomplete-parse false-green | FIXED (completeness cross-check) |
| 2 | 2 | WARNING | fail_count assignment not errexit-safe | FIXED (`|| true`) |
| 3 | 3 | WARNING | broad vs narrow test-at pattern mismatch | FIXED (narrow anchor both sides) |
| 4-11 | 1-4 | NIT | see per-iteration breakdown | all FIXED |

### Strengths (iteration 4, verified empirically)
- No false-GREEN path: dismissal requires fail_count>0, testat_count>=fail_count, and every named .test.js file passing alone; every ambiguity aborts.
- The narrowed completeness cross-check closes the pattern-mismatch hole (a non-.test.js failure drops the count below fail_count -> abort).
- Reporter-format dependency sound: node runs before shell/browser (run-tests.sh:159/161/173), so fail 0 reliably means a later non-node stage -> abort.
- errexit safe on both call shapes; bash 3.2 compatible; no em dashes.

### Validation
- `bash tools/test-cut-rerun-guard.sh` -> 20/20 assertions pass (bash 3.2.57), including controls that return the dangerous answer (a real red, a missing file, a fail-0 stray, a pattern-mismatch helper failure, an incomplete parse, a no-tally kill) all aborting, and the errexit regression guards.
- `bash -n` clean on the lib and release.sh.
- No `web/` change (no #1720 gate). Added a `test-*.sh` not a `*.test.js` (the #1934 node-coverage count is unaffected). No node engine change, so the node suite is unaffected by this diff.
- The full local suite could not be run: `tools/run-tests.sh` correctly refused because the box was reserved for a live 0.6.25 cut via the #1962 machine-claim guard, which must not be overridden during a release. The authoritative full-suite validation (node + `test:shell`, which runs `bash tools/test-cut-rerun-guard.sh` in-chain) is therefore GitHub CI on the pushed branch; merged only after CI is green.
