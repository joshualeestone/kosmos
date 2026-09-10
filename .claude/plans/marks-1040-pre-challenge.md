---
pre_challenge: true
method: challenge-loop
branch: marks-1040
diff_hash: be4b983a201c6b451a82e95584f488e1d7629a9e05bc61b070f75e6291c5ba7c
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T14:36:25Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs)
**Fixed:** 1 | **Deferred:** 4 (NITs) | **Asked:** 0

The change is sourcing-only: four new official-vendor provider marks under
`docs/provider-marks/` plus manifest entries. No `web/` change on this branch.
Two blind passes on different models (Sonnet, then Opus), each independently
re-verifying the manifest's fill-fraction / viewBox / byte-size / colour claims
against the actual files.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] docs/provider-marks/minimax-mark.svg:1 — leftover Adobe-Illustrator `<g>` wrappers with non-ASCII "Layer" ids + unused `xmlns:xlink` --> FIXED (commit c487c5b2): stripped both, single `<path>` under `<defs>`, manifest byte count 1220->1091 and note updated. Renders identically.
- [NIT] minimax-mark.svg — dead xmlns:xlink --> FIXED as part of the WARNING fix.
- [NIT] manifest.md:253 — forward-reference to the permission section reads before the argument it leans on --> DEFERRED: factually correct, per-section dating is clear.
- [NIT] manifest.md:3 — opening banner date describes the original six --> DEFERRED: the added section carries its own 2026-09-08 date header.
- Many STRENGTHs: all four SVGs well-formed, no script/image/remote-href/event-handlers; fill fractions/viewBoxes/byte-sizes independently re-measured and matching; DeepSeek Zhihu wrong-grab catch recorded; provenance-vs-permission honesty.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings (confirmed resolved):** the MiniMax cleanup confirmed fixed.
- [NIT] glm-zai-mark.svg / deepseek-mark.svg — `fill="currentColor"` on the root `<svg>` vs on each `<path>` (as anthropic-mark does) --> DEFERRED: both reviewers confirmed identical rendering standalone and inlined; root-level currentColor is inherited and valid.
- [NIT] minimax-mark.svg — gradient `gradientUnits="userSpaceOnUse"` --> DEFERRED: correct and faithful to the vendor export; works inlined because the path shares the coordinate space.
- All manifest claims independently re-verified; no blocking or warning-level issues. **Converged** — zero new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | minimax-mark.svg:1 | Illustrator `<g>` cruft + non-ASCII ids + unused xlink | FIXED | c487c5b2 |
| 2 | 1 | NIT | manifest.md:253 | forward-reference read-order | DEFERRED | factually correct |
| 3 | 1 | NIT | manifest.md:3 | opening banner date | DEFERRED | per-section dated |
| 4 | 2 | NIT | glm/deepseek svg | root vs path currentColor | DEFERRED | renders identically |
| 5 | 2 | NIT | minimax-mark.svg | gradient userSpaceOnUse | DEFERRED | faithful, works inlined |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- root-vs-path currentColor on two monochrome marks (harmless, deferred)
- gradient units on MiniMax (correct, deferred)
- two manifest read-order/date nits (deferred)

### Strengths (across all iterations)
- All four SVGs well-formed and safe to inline (no script/image/remote-href/event-handlers) — both passes.
- Fill fractions, viewBoxes, and byte sizes independently re-measured and matching the manifest — both passes.
- Colour treatment correct per mark (monochrome currentColor / brand gradient / two-tone), no hardcoded black — the known dark-mode defect class avoided.
- MiniMax gradient id pre-emptively renamed to the `pmark-*-g` convention, collision-safe for the piece-2 inline pass.
- Provenance-vs-permission honesty; the DeepSeek Zhihu wrong-grab catch recorded.
