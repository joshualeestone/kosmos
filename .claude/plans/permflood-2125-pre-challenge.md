---
pre_challenge: true
method: challenge-loop
branch: permflood-2125
diff_hash: f01ff09ab458ffcca85203570f742dd3c4545b92398f51dced36cc91b43060cd
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T19:12:33Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 total across the branch (2 on the slice-1 scan code, 1 on the #1652 importScan reconcile)
**Converged:** Yes (the reconcile pass surfaced zero new BLOCKERs/WARNINGs/CONVENTIONs; one NIT fixed)
**Total findings:** 4 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs)
**Fixed:** 1 | **Deferred:** 1 | **Noted (NIT):** 2

kosmos#2125 slice 1 (stop the fresh-install AUTO disk scan from entering TCC folders) PLUS the #1652
reconcile (move the TCC-folder discovery onto an opt-in importScan path so Renet's loose-file import
is not regressed). The branch is discover.js only (engine flag + tcc-roots test); the server route and
import UI are Renet's (fix-1652-import-ui / #2147). All validation and the subdir audit passed on the
final HEAD (hash f01ff09ab458).

### Per-Iteration Breakdown

#### Iteration 1 (slice-1 scan code)
0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs (+ 4 STRENGTHs)
- [WARNING] discover.js SCAN_SKIP is global-by-name, so a nested folder named Documents is skipped too, not only top-level ~/Documents --> DEFERRED (documented): consistent with the pre-existing Downloads/Desktop/Music/etc. global-name skipping; making Documents top-level-only would be inconsistent.

#### Iteration 2 (slice-1 scan code)
0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (+ 5 STRENGTHs). CONVERGED for slice 1.
- [NIT] SCAN_SKIP matches Documents case-sensitively (consistent with every entry; TCC folders are canonical-cased). NOTED.
- [NIT] the walk tests exercise a nested Documents (global-by-name); top-level exclusion is covered by the defaultScanRoots test. NOTED.

#### Iteration 3 (the #1652 importScan reconcile, first review of the new flag)
0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (+ 6 STRENGTHs). CONVERGED.
- [NIT] plan Tests section said "3 arms" but the file now has 5 (the two importScan arms were unlisted) --> FIXED: updated the plan to describe all 5.

### Final Ledger

| # | Iter | Category | Location | Description | Status | Resolution |
|---|------|----------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | discover.js SCAN_SKIP | global-name skip over-reaches nested "Documents" | DEFERRED | consistent w/ sibling home-dir names; documented |
| 2 | 2 | NIT | discover.js SCAN_SKIP | case-sensitive match | NOTED | consistent w/ all entries; TCC folders canonical-cased |
| 3 | 2 | NIT | tcc-roots test | no top-level-Documents integration arm | NOTED | mechanism identical at every depth; defaultScanRoots test covers top-level |
| 4 | 3 | NIT | plan Tests section | stale "3 arms" count | FIXED | updated to 5 arms with importScan description |

### Strengths (across all iterations)
- The importScan flag threads correctly: scan({importScan:true}) with no roots/env falls to defaultScanRoots(o) which reads opts.importScan; bare scan() (the /api/scan-agents auto path) never sets it, so it stays TCC-free. Verified end to end.
- SCAN_SKIP filters only descended CHILDREN, never self-skips a root, so importScan reaches ~/Documents (added as an explicit root) while the auto $HOME walk stays out of it; it does not poison seenDirs.
- Auto path genuinely TCC-free (Documents removed from SCAN_DEEP_NAMES and added to SCAN_SKIP; importScan roots gated behind if(importScan) so they cannot leak into the auto path).
- Depth/importOnly semantics correct (Documents deep+non-importOnly, Downloads/Desktop DROP_DEPTH+importOnly); the importOnly plumbing engages.
- Tests pin behavior non-vacuously with controls that fail in the dangerous direction; the test4 (root is added) + test5 (such a root is walked) decomposition soundly proves importScan reaches Documents given defaultScanRoots cannot be pointed at a fixture home.
- Sandbox guard unchanged and correct for both modes; defaultScanRoots(undefined) backward-compatible.
- No em dashes in added engine/test lines. The discover.js-only seam is respected (no server.js change; that is Renet's).

### Deferred / follow-up
- The SCAN_SKIP global-by-name skip (finding 1), noted for the follow-up.
- #2125 Symptom 2 (bash-notice burst): deferred by Splinter, needs an app-identity launch re-architecture (design per #2133). The com.kosmos.open-once self-teardown gap is carded as #2151.
- #2125 Symptom 3 (a11y Continue-gate): blocked on a Josh ruling (09-01 offer-not-require vs 09-04 gate-it); Splinter is routing it.
- This branch alone leaves ~/Documents agents unreachable until Renet's import route ships; by design, per the agreed seam. #2125 stays open until all slices land and Josh verifies on a fresh account.
