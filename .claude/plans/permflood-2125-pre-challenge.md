---
pre_challenge: true
method: challenge-loop
branch: permflood-2125
diff_hash: 1aece85d1cbf2254a60ad16a9c0f7978e3df8446bbec13fea3767a3e853caee9
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T18:43:01Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 surfaced zero new BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 3 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs)
**Fixed:** 0 | **Deferred:** 1 | **Asked:** 0 | **Noted (NIT):** 2

kosmos#2125 SLICE 1: stop the fresh-install auto disk scan (`discover.scan()`, via
`/api/scan-agents` from the empty-state) from entering the TCC-protected home folders
(~/Documents/~/Downloads/~/Desktop), which fired macOS permission prompts on a fresh macOS user
(the Documents one BROKE the scan when denied). Baseline (6.0) initially refused because the box
was reserved for release 0.6.29 (the staging cut #2129 triggered); re-run after the release finished
passed clean.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs (+ 4 STRENGTHs)
- [WARNING] engine/discover.js SCAN_SKIP — adding `Documents` to SCAN_SKIP matches by folder NAME at every depth, so a nested folder literally named `Documents` (e.g. `~/work/clientX/Documents/<agent>`) is skipped too, not only the top-level `~/Documents` TCC protects --> DEFERRED (9dfd238c documents it): deliberately CONSISTENT with the pre-existing global-name skipping of Downloads/Desktop/Music/Movies/Pictures/Public (each already over-reaches a same-named nested folder); making Documents top-level-only would be inconsistent and add a path-based special case. Noted for the follow-up rescan slice.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (+ 5 STRENGTHs)
**Converged** — no new actionable findings.
- [NIT] engine/discover.js — SCAN_SKIP matches 'Documents' case-sensitively; consistent with every existing entry and macOS TCC folders carry canonical casing, so not a regression. NOTED.
- [NIT] discover.tcc-roots-2125.test.js — the walk tests exercise a nested `Documents/` (the global-by-name behavior); the top-level `~/Documents` exclusion is covered by the `defaultScanRoots()` test instead. The skip mechanism applies identically at every depth, so coverage is adequate. NOTED.

### Final Ledger

| # | Iter | Category | Location | Description | Status | Resolution |
|---|------|----------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | discover.js SCAN_SKIP | global-name skip over-reaches nested "Documents" | DEFERRED | consistent w/ sibling home-dir names; documented (9dfd238c); follow-up rescan slice |
| 2 | 2 | NIT | discover.js SCAN_SKIP | case-sensitive match | NOTED | consistent w/ all entries; TCC folders are canonical-cased |
| 3 | 2 | NIT | tcc-roots test | no top-level-Documents integration arm | NOTED | mechanism identical at every depth; defaultScanRoots test covers top-level |

### Deferred / follow-up (documented in the plan, surfaced here)
- The SCAN_SKIP global-by-name skip (finding 1) - the follow-up user-triggered rescan slice should
  know the skip is not $HOME-scoped.
- Symptom 2 of #2125 (the "bash can run in the background" notice burst) - needs an app-identity
  launch re-architecture; its own design + card, flagged to Splinter.
- Symptom 3 (the a11y Continue-gate) - separate slice.

### Strengths (across both iterations)
- TCC exposure closed on every auto-scan path and closed EARLY: SCAN_SKIP fires before any lstat of
  the child, so ~/Documents/~/Downloads/~/Desktop are never even stat'd during the $HOME walk. All
  three reach-paths eliminated (deep root, $HOME descent child, importOnly root).
- Both required changes present and load-bearing (Documents needed removal from SCAN_DEEP_NAMES AND
  addition to SCAN_SKIP; Downloads/Desktop only needed their importOnly roots dropped).
- No collateral breakage: DROP_DEPTH/importOnly plumbing dormant-not-dead (still exercised by the
  #1652 import test via explicit roots); normal discovery (work/projects/dev/src/code/repos) intact.
- Tests non-vacuous with controls that fail in the dangerous direction; defaultScanRoots() export is
  minimal and touches no filesystem; fully sandboxed.
- Plan/comments accurate (root-cause correction from appLocationCheck to discover.scan()); no em
  dashes in added lines.
