---
pre_challenge: true
method: challenge-loop
branch: orgchart-firstring-bc-6196
diff_hash: 1e44005448287d487deee6488dddf8745c17a6413b09774abb3967afdf03cf94
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T11:46:10Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (blind, model-rotated: opus / sonnet / opus / sonnet / opus)
**Converged:** Yes (iteration 5 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 6 WARNINGs + 1 recurring CONVENTION + several NITs
**Fixed:** 5 WARNINGs | **Deferred:** 1 WARNING (fail-safe) + the CONVENTION-equivalent + NITs

This adds the in-browser regression guard for #4499 (`render-org-first-ring-6196.js`) plus its
board wiring. The load-bearing design question (how the as-drawn threshold reads the squeeze) was
escalated to and ruled by Liu Kang (m5697). An independent review by Kano confirmed all four of
Liu Kang's checks, including the final-driver RED on #6196.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
**New findings:** 0 BLOCKER, 2 WARNINGs, 1 CONVENTION, NITs
- [WARNING] README row + driver header described an even "dozen-plus roots, two reports each" board and a "three-root" lanes first ring --> FIXED: the real board is one heavy root (100 reports) + 19 light; lanes has a first ring of ONE root.
- [CONVENTION] .claude/plans/ -- no plan file (addressed at PR time; the pre-challenge-gate hook requires one).

#### Iteration 2 (sonnet)
**New findings:** 0 BLOCKER, 2 WARNINGs, NITs
- [WARNING] README still described a fixed 8.4px threshold --> FIXED: the per-width rule (12px as drawn, floored at 8.4 on a squeezed phone).
- [WARNING] the drawn scale was trusted without a bound; a scale > 1 had no cap --> FIXED: a plausible-range gate and a cap at 1 (later refined in iter 3/4).

#### Iteration 3 (opus)
**New findings:** 0 BLOCKER, 1 WARNING, 1 CONVENTION, NITs
- [WARNING] the drawn CANVAS scale (size/natural) understates the radius scale k (ORG_PAD vs ORG_PAD_MIN), so 12 x canvas-scale is ~0.4px lenient at partial squeeze. ESCALATED (it was Liu Kang's directed method, m5645). Liu Kang ruled (b), m5697 --> FIXED: drawnK reads the TRUE k from the drawn faces (a face's rendered distance from the hub / its placement radius), over >=3 faces agreeing within 1% else NaN; the gate is then exact.
- A reviewer NIT suggested asserting the first ring spans >1 radius; NOT added, because that is the post-fix bumping behaviour and would wrongly break the pre-fix RED.

#### Iteration 4 (sonnet)
**New findings:** 0 BLOCKER, 2 WARNINGs, NITs
- [WARNING] the drawnK face cutoff (r>1) and 1% (then 0.5%) tolerance were thin against toFixed(1) position rounding --> FIXED: skip faces below 40px placement radius, agree within 1%.
- [WARNING] on a face disagreement, print min/max/count to tell a drift from a bad read --> DEFERRED: drawnK already fails RED on disagreement (the correct direction); the gain is diagnostic readability, not correctness.

#### Iteration 5 (opus)
**New findings:** 0 BLOCKER, 0 WARNING, 1 CONVENTION (the plan file), 2 NITs
**Converged** -- the reviewer verified the k method against the page and found no errors.
- [NIT] the 1% agreement is "safe, just strict"; [NIT] a NaN-k gate failure can print a misleading PASS on the clearance line though the run still reds. Both fail-safe; DEFERRED.

### Final-driver RED / GREEN (Liu Kang check d; the driver is byte-identical at HEAD, only docs were added after)
- RED (final driver + a pre-#4499 page, detached fixture): desktop k=0.786, threshold 9.4px, FAIL `least 4.9px (r2 past r19)` -- the root-vs-root bug; phone identical; the segDist control, came-to-rest, 120 faces/wires, the 20-roots non-vacuity gate, and the k-read gate all PASS; reproduced on the flaky-retry (same 4.9px).
- GREEN (final driver + the fixed page): desktop k=0.742, threshold 8.9px, PASS `least 13.3px`; phone identical.
- The driver comment's ~6.3px is a PLACEMENT figure (natural space); the check prints the DRAWN clearance (6.3 natural x k = ~4.9px on the RED page). The GREEN k is LOWER than the RED k (the fix pushes roots outward, more squeeze) yet the drawn clearance rises (18 natural x 0.742 = 13.3px), which is the fix working.

### Final Ledger
| # | Iter | Category | Origin | Description | Status |
|---|------|----------|--------|-------------|--------|
| 1 | 1 | WARNING | BRANCH | README + header described the vacuous even board / a 3-root lanes ring | FIXED |
| 2 | 2 | WARNING | BRANCH | README threshold text was the old fixed 8.4px | FIXED |
| 3 | 2 | WARNING | BRANCH | drawn scale ungated, no cap | FIXED |
| 4 | 3 | WARNING | BRANCH | canvas scale understates k (Liu Kang m5697 ruled (b)) | FIXED |
| 5 | 4 | WARNING | SELF | drawnK face cutoff / tolerance thin vs toFixed rounding | FIXED |
| 6 | 4 | WARNING | SELF | drawnK disagreement diagnostics | DEFERRED (fail-safe) |
| - | 1-5 | CONVENTION | BRANCH | no .claude/plans plan file | ADDRESSED (plan committed at PR time) |

### NITs (non-blocking)
- drawnK agreement is strict (a single mis-rested node reds; fail-safe); a NaN-k failure can print a misleading PASS on the clearance line though the run still reds; the 15s settle cap on this 120-node board is the main flake surface (fail-RED). First-ring detection assumes a root's wire-start is the hub centre (robust for this board). Clearance is first-ring-line vs ALL faces (a superset of root-vs-root; the reported "where" may name a child).

### Strengths
- Fails loud in every degraded path (missing element, empty selector, failed boot, NaN k) -- always RED, never a silent PASS.
- readConsts throws if ORG_LINE_CLEAR / ORG_SQUEEZE_MIN are renamed.
- The board genuinely clusters (an even board was vacuous at 52px; documented), and the RED/GREEN discriminate on the final driver.
- Independent review (Kano) confirmed all four of Liu Kang's checks, including (d).
