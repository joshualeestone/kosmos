---
pre_challenge: true
method: challenge-loop
branch: scan-import-scanning-3b
diff_hash: d9bb0d7f2506440dcda74a9b7e3e21ddce295786798b3cf3fdcac0ef7428248a
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T10:04:18Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3: 0 new BLOCKER / WARNING / CONVENTION; "clean converging pass")
**Total findings:** 1 BLOCKER, 3 WARNINGs, ~5 NITs
**Fixed:** 1 BLOCKER + 3 WARNINGs + 2 NITs | **Deferred:** 3 NITs | **Asked:** 0

### What this branch is (Josh 0.6.42 #3/#4, front-end half b)

Wires the front end to Kitty's merged #2391 engine, which made /api/scan-import TWO-PHASE:
`scanning: true` (partial -- non-TCC rows now, the app-identity hatch's ~/Documents,~/Downloads,~/Desktop
rows land ~1s later) or `bounded.tccUnavailable: true` (complete, but those folders could not be read).
On top of the merged half (a) (an S9 grant-flip re-scan poll).

- `fetchImportScanComplete(onPartial, isStale)`: fetch /api/scan-import, retry while scanning:true
  (~FR_IMPORT_RETRY_MS apart, MAX cap), onPartial on non-final iterations (non-TCC rows show now),
  isStale() stops a superseded scan, a hard failure returns immediately.
- `frScanAgents` granted path uses it (gen-guarded partial repaint). `FR_SCAN_INFLIGHT` (set at scan
  entry, cleared at settle, guarded by mine===FR_SCAN_GEN) gates `frArmRescanOnGrant`: block arming
  DURING a scan (a partial must not arm a racing poll), allow it AFTER a settled not-delivered granted
  scan (so a granted-entry hiccup/exhaustion recovers). `FR_SCAN_FULL = full && scanOk && (!out ||
  out.scanning !== true)` (partial=not-full -> poll retries; tccUnavailable=full -> poll stops).
- `populateFoundImports` (import mode) uses the helper with a per-call `FR_IMPORT_POP_GEN` guard.
- tccUnavailable hint in `frPaintScan` (rows-present) and `populateFoundImports`.

### Validation

Final full suite (b1g32a5qs) on a8b3f64d: tools/run-tests.sh -- PASS (5016 tests, 0 fail; the
a8b3f64d delta over 8e01266c, which was 5016/0, is a browser-check-only change). Hermetic browser
check render-firstrun-scan-on-grant-1652.js = 30/30 (run 6x by the iter-3 reviewer). #1720
browser-check gate satisfied (a docs/browser-checks change is in the diff). Guards proven to red:
scenario 9 failed pre-fix; scenario 10 hint perturbed -> red; scenario 11 -> 12 fails when
FR_SCAN_INFLIGHT is not cleared at settle.

### Per-Iteration Breakdown

#### Iteration 1 (blindhb1)
**New findings:** 1 BLOCKER, 1 WARNING, 1 NIT
- [BLOCKER] my own earlier FR_SCAN_GRANTED fix foreclosed the "one retry" for a GRANTED scan that hiccups/exhausts at S9 ENTRY (grant already true): FR_SCAN_GRANTED could not tell an in-flight partial (must not arm) from a settled-not-delivered granted scan (must arm), so frArmRescanOnGrant blocked the poll and there was no recovery but a reload --> FIXED da1dcd1b: replaced with FR_SCAN_INFLIGHT (block during, allow after settle); guarded by new scenario 11
- [WARNING] fetchImportScanComplete's retry loop had no staleness guard -> a superseded scan kept fetching --> FIXED da1dcd1b: isStale() checked each iteration, both callers pass their gen check
- [NIT] populateFoundImports outer try/catch is dead-but-benign --> DEFERRED (body==null already handles hard failures; reviewer: not worth a code change)

#### Iteration 2 (blindhb2)
**New findings:** 0 BLOCKER (FR_SCAN_INFLIGHT lifecycle confirmed correct), 1 WARNING, 3 NITs
- [WARNING] the expect500 500-tolerance comment said "scenario 8 is last" but 9/10/11 come after, so expect500 stayed true through 9/10 (loose) --> FIXED 8e01266c: scoped to only the 500-producing scenarios (8, 11), reset after each recovers (race-free via the recovery await); comment corrected
- [NIT] fetchImportScanComplete double-painted the final exhausted partial (onPartial + caller) --> FIXED 8e01266c: onPartial only on non-final iterations
- [NIT] persistent-scanning engine -> unbounded S9 poll --> DEFERRED: the plan's acknowledged weakest premise + engine-contract dependency (engine self-limits to tccUnavailable), consistent with half (a)
- [NIT] import-mode empty+tccUnavailable renders a lone hint --> DEFERRED: defensible (a different surface from the Josh-ruled S9 empty-arm); product note

#### Iteration 3 (blindhb3)
**New findings:** 0 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** -- adversarial trace of the INFLIGHT/poll/FR_SCAN_FULL state machine (the parts flagged for hardest scrutiny given the "wrong twice before settling" history) all correct; 6 STRENGTHs; browser check 30/30 six times.
- [NIT] scenario 11 asserted !armed11.inflight -- a transient flag observed at an uncontrolled moment (flake risk) and redundant with armed===true --> FIXED a8b3f64d: dropped it
- [NIT] a hard engine throw in getImportScan -> route 200 {ok:false} -> FR_SCAN_FULL true stops the poll --> DEFERRED: pre-existing, identical to half (a), NOT changed by this branch, rare

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | granted-entry hiccup/exhaustion foreclosed the retry | FIXED | da1dcd1b (FR_SCAN_INFLIGHT) |
| 2 | 1 | WARNING | retry loop no staleness guard | FIXED | da1dcd1b (isStale) |
| 3 | 1 | NIT | dead-but-benign try/catch | DEFERRED | body==null handles it |
| 4 | 2 | WARNING | expect500 scoping loose + stale comment | FIXED | 8e01266c |
| 5 | 2 | NIT | double-paint of the exhausted partial | FIXED | 8e01266c (onPartial i<MAX) |
| 6 | 2 | NIT | persistent-scanning unbounded poll | DEFERRED | weakest premise / engine-contract dep |
| 7 | 2 | NIT | import-mode empty+tccUnavailable lone hint | DEFERRED | defensible; product note |
| 8 | 3 | NIT | scenario 11 transient-flag assertion | FIXED | a8b3f64d |
| 9 | 3 | NIT | hard engine throw (getImportScan) | DEFERRED | pre-existing, identical to half (a) |

### Outstanding questions (ASKED)
None.

### Deferred, needing a decision beyond this branch
- **S9 EMPTY create-arm + tccUnavailable is left SILENT (no hint)**, because Josh's standing ruling on
  that arm is "stays silent... never a report on our own uncertainty" (why the find-agents link was
  removed twice). A tccUnavailable hint there would violate it. This CONFLICTS with Kitty's "show a
  hint" contract for that one case; I did not silently override Josh's ruling. Raise with Josh/Mona:
  should the empty create screen say "could not scan Documents" when tccUnavailable? It self-heals on
  a later re-scan. (The hint IS shown in frPaintScan rows-present + import mode, which are not the
  ruled empty-arm.)
- The tccUnavailable hint copy is a plain placeholder; may want Mona's review.

### Strengths (across iterations)
- FR_SCAN_INFLIGHT set/clear is stuck-true-proof and superseded-clear-proof (adversarial trace, iter 3)
- The in-flight-vs-full split blocks the partial-arming race yet preserves the granted-entry retry (iter 1/3)
- FR_SCAN_FULL correct across bare / granted-complete / partial-exhausted / hiccup / tccUnavailable (iter 2/3)
- populateFoundImports stale-paint-safe; independent of the S9 poll (iter 3)
- Scenarios 9/10/11 are non-vacuous, can fail (proven), expect500 tightly scoped, no em dashes (iter 3)
