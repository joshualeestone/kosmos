---
pre_challenge: true
method: challenge-loop
branch: adoption-restyle-2025
diff_hash: 72f6f76fa68aa296b92230c65d8ac8ca443dac6be4d12850c2b41d1cffef2f6e
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T22:59:37Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 produced zero new actionable findings)
**Total findings:** 5 (0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 3 NITs)
**Fixed:** 2 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Change under review (#2025)

The disk-scan adoption offer (`#scan-wrap`, feature #1938) followed the person off the Agents tab
(Projects, the create forms, every Settings page) and letterboxed its scanned-file preview.
Re-measured against current origin/main, because the #1938 rework already delivered two of the design
spec's four fixes (real `.btn.uprime` rows, a proper toggle plus arming dismiss head). Two defects
survived:

- `#scan-wrap` was hidden off `#found-wrap`'s tab-switch branch but not its own, and the 5s poll is
  gated to the Agents tab, so once shown it stayed on every other tab. Fixed as an exact `#found-wrap`
  mirror: a `.hidden = true` line in the `if (!agents)` branch of `showTab`, and `#scan-wrap` added to
  the consolidated-view hide CSS.
- `.fr-scanpreview` was `white-space: pre`, forcing a horizontal scrollbar. Fixed to
  `pre-wrap; overflow-wrap: anywhere` (the pairing the file's other preview surfaces use at :465, :3789).

Coverage: `docs/browser-checks/render-scan-board.js` gained two assertions (no horizontal letterbox on
both a long prose line and a long unbroken path; the panel hides on an in-page tab switch). 18/18 on
this branch; positive control 16/18 on origin/main (both new assertions FAIL there: `whiteSpace=pre`
and off-tab `hidden=false`), proving they catch the exact defect. A plan file
(`.claude/plans/adoption-restyle-2025.md`) documents the change.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
- [CONVENTION] .claude/plans/ - No plan file for this branch --> initially DEFERRED, then RESOLVED in iteration 3 by creating `.claude/plans/adoption-restyle-2025.md` (the pre-challenge-gate requires a plan file distinct from the proof).
- [NIT] web/index.html `.fr-scanpreview` - `pre-wrap` alone lets a single unbreakable token re-open the letterbox --> FIXED (1aa9de49): added `overflow-wrap: anywhere`; extended the browser check's preview with an unbroken-path line.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (both no-change-needed)
**Duplicates:** 1 (the plan-file CONVENTION)
- [NIT] `overflow-wrap: anywhere` breaks a long path mid-token --> NO CHANGE: correct tradeoff vs a horizontal letterbox; full path stays present and selectable.
- [NIT] render-scan-board.js dead `named` parameter --> NO CHANGE: pre-existing, out of scope.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 0 NITs
- [CONVENTION] .claude/plans/adoption-restyle-2025.md - five em dashes in the plan file --> FIXED (e017e2b5): replaced with commas. (This iteration also created the plan file itself, resolving iteration 1's CONVENTION.)

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (pre-existing)
**Converged** - no new actionable findings.
- [NIT] a pressed scan row's "Added"/undo result stays hidden across a tab switch until the row resolves --> DEFERRED: identical to pre-existing `#found-wrap` behavior this change mirrors, and consistent with the panel's "the report is finished being read when they leave the screen" philosophy; not introduced here.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | No plan file for branch | FIXED | Created adoption-restyle-2025.md (iter 3) |
| 2 | 1 | NIT | web/index.html fr-scanpreview | pre-wrap without overflow-wrap | FIXED | 1aa9de49 |
| 3 | 2 | NIT | web/index.html | overflow-wrap breaks path mid-token | DEFERRED | Correct tradeoff vs a horizontal letterbox |
| 4 | 2 | NIT | render-scan-board.js | dead `named` parameter | DEFERRED | Pre-existing, out of scope |
| 5 | 3 | CONVENTION | plan file | five em dashes | FIXED | e017e2b5 |
| 6 | 4 | NIT | web/index.html scan/found | pressed-row result hidden across tab switch | DEFERRED | Pre-existing found-wrap behavior, intended |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- overflow-wrap breaks a long path mid-token (iter 2) - accepted tradeoff.
- dead `named` parameter in render-scan-board.js (iter 2) - pre-existing.
- pressed-row result hidden across a tab switch (iter 4) - pre-existing/intended.

### Strengths (across all iterations)
- Correct diagnosis and complete parity: the fix mirrors `#found-wrap` at every hide site (the `showTab` off-tab branch, the consolidated-view CSS, the paint function's own off-tab guard, the dismiss handler); sibling parity confirmed complete, no fourth site missed.
- No regression: hiding `#scan-wrap` off-tab is idempotent with `paintScanBoard`, which re-shows it on return to the Agents tab; `SCAN_OPEN`/`SCAN_SIG`/the in-flight-row guard/dismiss handler are untouched; `.fr-scanpreview` is scan-only, no cross-panel bleed.
- The consolidated-view child-combinator selector is well-formed; `#scan-wrap` is a verified direct body child alongside its siblings.
- Both browser-check assertions are sound and discriminating: behavioural (`scrollWidth <= clientWidth + 2`) plus the property, exercising both `pre-wrap` and `overflow-wrap: anywhere`; the tab-switch check reads the synchronous handler at 300ms (well under the 5s poll) and cross-checks `onAgentsTab === false`; a documented positive control fails both on origin/main.
- The plan file accurately describes the change with no overclaim, and is em-dash-free after iteration 3.
