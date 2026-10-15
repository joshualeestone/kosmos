---
pre_challenge: true
method: challenge-loop
branch: orgchart-deeptrees-4499
diff_hash: 45515ad906c01ff40ca4d0375ce8de3700df64cab21607c63470d2f70dda7b2c
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T02:04:01Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (6.0 initial validation skipped on a recorded clean verdict; 5 fresh blind reviewer passes)
**Converged:** Yes
**Total findings:** 4 BLOCKERs (0), WARNINGs, CONVENTIONs, NITs across 5 passes; every actionable finding fixed or deliberately deferred.
**Fixed:** (see ledger) | **Deferred:** 3 | **Asked (awaiting user):** 0

Model rotation (kosmos#2032): opus, sonnet, opus, sonnet, opus. Convergence witnessed by both models.

The core layout logic (orgPlace / orgFirstRingClear / orgPlaceGated) was confirmed correct by every reviewer; no logic defect was found in any pass. Iterations 2-4 refined comment honesty and test coverage (the kosmos#120 comment-churn pattern: later passes found nits in comments earlier passes wrote -- recorded per-iteration below). The two recurring themes (as-drawn-vs-natural, first-ring-vs-full) are resolved (as-drawn: a probe proved every funded chart reaches ~18px first-ring clearance, so 12px holds as drawn at the 0.7 squeeze; a guard assertion now pins it) and deferred (runtime full-check: a conscious performance tradeoff per the gate design, with the guard's sweep closing the gap).

### Post-convergence changes (recorded for honesty; not loop-reviewed)

Two changes landed after the loop converged, both covered by the diff_hash but not by a blind loop pass:

1. The plan file (ledger #1, FIXED): pure documentation the gate requires; no code.
2. `docs/browser-checks/render-orgchart-phone-718.js:313` switched from `orgPlace` to `orgPlaceGated` so the check compares against what `paintOrg` now draws. PM-directed (Liu Kang m5510/m5516). Behavior-neutral on its fixture: the 718 desktop board is a flat 5-root fleet, which `orgPlaceGated` never funds (first-ring clearance ~114px, far above 12), so it returns `orgPlace`'s layout unchanged (maxR 120, natural 396). Measured independently by Liu Kang and Sub-Zero; verified by re-running render-orgchart-phone-718 at the new head. Reviewed via the PM + independent-reviewer + browser-check path rather than a blind loop pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 (ITER_COMMITS empty; nothing had committed yet)
- [WARNING] web/index.html -- dual derivation of the first-ring floor (convention #5) --> FIXED (65e04b154: extract ORG_LINE_MARGIN + pinning test + 4 sibling lifts)
- [WARNING] web/index.html -- orgFirstRingClear comment asserted a structural guarantee the code lacks --> FIXED (65e04b154: comment made empirical)
- [CONVENTION] web/index.html -- raw margin literal 6 --> FIXED (65e04b154: ORG_LINE_MARGIN)
- [CONVENTION] .claude/plans/ -- no plan file --> FIXED (9068618ac: the pre-challenge gate requires a plan file alongside the proof, so the deferral was invalid; added the decision-record plan at PR time; no code change)
- [NIT] vacuous funded clause floClear >= preClear - 0.05 --> FIXED (65e04b154: removed)
- [NIT] equal-shares branch unreachable from prod --> DEFERRED (defensive for direct callers)
- [NIT] flat-fleet wasted second pass vs comment --> FIXED (65e04b154: comment softened)
- [NIT] NON-BUG test lacked "at least one asserted" control --> FIXED (65e04b154)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 6 NITs (1 CONVENTION dup)
**Self-generated:** 1 (the margin comment at ORG_LINE_MARGIN, written by 65e04b154, was prose; fixed per the SELF-prose rule by pointing it at the verifying checks)
- [WARNING] first-ring-only funding cannot rule out a deeper line worse; sweep sampled --> DEFERRED (m5379-approved first-ring runtime, 0 divergences/1041 trees; comment honest)
- [WARNING] 12px tested at natural scale, rule is as-drawn (0.7 squeeze) --> FIXED (02d4ed859: margin comment honest) + later resolved in iter 4 by test
- [WARNING] siblings test proportional only, not floored --> FIXED (02d4ed859: overlap-never-worse assertion added to funded sweep; size-bound prevents donor overcrowding)
- [WARNING] guard header described the removed "no worse than prop" clause --> FIXED (02d4ed859)
- [NIT] #4472 constants comment contradicted by the hoist --> FIXED (02d4ed859)
- [NIT] equal-shares comment overstated when it fires --> FIXED (02d4ed859)
- [NIT] water-fill comment implied multi-pass convergence --> FIXED (02d4ed859: one-pass exact)
- [NIT] guard EMBED_PROP_MAXR stale-guard message --> DEFERRED (intentional stale guard; message accurate)
- [NIT] BUG_FIXTURES no funded assert; NON-BUG could skip 2/3 --> FIXED (02d4ed859: funded===true + asserted>=2 + 2nd single-root fixture)
- [NIT] header SHA citations unverifiable from test --> DEFERRED (m5401 red-on-SHA proof; verifiable by re-run; PR body also carries them)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
**Self-generated:** 0 (findings were on base-commit lines: the sweep, the early-out, the assert.fail returns)
- [WARNING] guard sweep (~8 charts) thin for the safety invariant --> FIXED (1b8b4535a: widened to 16 shapes)
- [NIT] orgPlaceGated ran O(roots^2) preClear scan before the cheap root-count reject --> FIXED (1b8b4535a: reordered)
- [NIT] dead return after assert.fail --> FIXED (1b8b4535a: removed)
- 4 STRENGTHs confirmed iter-1/2 fixes.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 3 NITs
**Self-generated:** 2 (the comment-order NIT on orgPlaceGated's header comment rewritten in 02d4ed859; the orgFirstRingClear wording on the comment written in 65e04b154 -- both prose, fixed by correcting to match the code)
- [WARNING] honest-funded not enforced at runtime; sweep 16 shapes --> DEFERRED runtime-full-check (m5379); wording tightened (1a1ede2df)
- [WARNING] funds on natural >=12 but rule is as-drawn; 12 threshold maybe redundant, untested --> FIXED (1a1ede2df: probe showed every funded chart reaches ~18px first-ring clearance; guard now asserts funded floClear >= ORG_LINE_CLEAR+ORG_LINE_MARGIN-0.1, pinning the [12,18) band empty; resolved, not deferred)
- [NIT] NON-BUG near-tautological for single-root; multi-root may skip --> FIXED (1a1ede2df: wide3 multi-root fixture + multiAsserted control)
- [NIT] EMBED_PROP_MAXR / header SHA --> DEFERRED (dup of iter-2)
- [NIT] orgPlaceGated comment order reversed vs reordered code --> FIXED (1a1ede2df)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (dup of a DEFERRED entry), 1 CONVENTION (dup)
**Self-generated:** 0
**Converged** -- the only non-STRENGTH findings deduplicate against ledger entries (runtime full-check, DEFERRED; no plan file, which was deferred at iteration 5 and later FIXED at PR time when the gate required it). The reviewer itself framed the WARNING as "a conscious, documented performance tradeoff ... a residual risk to surface rather than a defect." 5 STRENGTHs confirmed the whole change.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | 9068618ac plan file added at PR time (gate requires it) |
| 2 | 1 | WARNING | web/index.html | BRANCH | dual derivation of floor formula | FIXED | 65e04b154 |
| 3 | 1 | WARNING | web/index.html | BRANCH | comment overclaims structural guarantee | FIXED | 65e04b154 |
| 4 | 1 | CONVENTION | web/index.html | BRANCH | raw margin literal | FIXED | 65e04b154 |
| 5 | 1 | NIT | web/index.html | BRANCH | vacuous funded clause | FIXED | 65e04b154 |
| 6 | 1 | NIT | web/index.html | BRANCH | equal-shares branch unreachable from prod | DEFERRED | defensive for direct callers |
| 7 | 1 | NIT | web/index.html | BRANCH | flat-fleet wasted pass vs comment | FIXED | 65e04b154 |
| 8 | 1 | NIT | guard | BRANCH | non-bug test lacked asserted control | FIXED | 65e04b154 |
| 9 | 2 | WARNING | web/index.html | BRANCH | first-ring-only funding / sampled sweep | DEFERRED | m5379 approved; guard sweep closes gap |
| 10 | 2 | WARNING | web/index.html | SELF | 12px natural vs as-drawn | FIXED | 02d4ed859 comment + 1a1ede2df test |
| 11 | 2 | WARNING | sibling tests | BRANCH | floored layout not overlap-checked | FIXED | 02d4ed859 overlap-never-worse |
| 12 | 2 | WARNING | guard | BRANCH | stale header clause | FIXED | 02d4ed859 |
| 13 | 2 | NIT | web/index.html | BRANCH | #4472 constants comment stale | FIXED | 02d4ed859 |
| 14 | 2 | NIT | web/index.html | BRANCH | equal-shares comment overstates | FIXED | 02d4ed859 |
| 15 | 2 | NIT | web/index.html | BRANCH | water-fill comment implies multi-pass | FIXED | 02d4ed859 |
| 16 | 2 | NIT | guard | BRANCH | EMBED stale-guard message | DEFERRED | intentional |
| 17 | 2 | NIT | guard | BRANCH | BUG_FIXTURES no funded assert / NON-BUG skip | FIXED | 02d4ed859 |
| 18 | 2 | NIT | guard | BRANCH | header SHA citations unverifiable | DEFERRED | m5401 proof, verifiable by re-run |
| 19 | 3 | WARNING | guard | BRANCH | sweep thin (~8 charts) | FIXED | 1b8b4535a widened to 16 |
| 20 | 3 | NIT | web/index.html | BRANCH | preClear scan before root-count reject | FIXED | 1b8b4535a reordered |
| 21 | 3 | NIT | guard | BRANCH | dead return after assert.fail | FIXED | 1b8b4535a |
| 22 | 4 | WARNING | web/index.html | SELF | as-drawn 12px untested | FIXED | 1a1ede2df funded-reaches-margin assertion |
| 23 | 4 | NIT | guard | SELF | NON-BUG multi-root skip | FIXED | 1a1ede2df wide3 + multiAsserted |
| 24 | 4 | NIT | web/index.html | SELF | orgPlaceGated comment order | FIXED | 1a1ede2df |
| 25 | 5 | WARNING | web/index.html | BRANCH | runtime gate narrower than preserved property | DEFERRED | dup of #9; conscious tradeoff (m5379) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
All NITs above were either FIXED or DEFERRED; none left open.

### Strengths (across all iterations)
- The proportional (non-bug) path is byte-identical to the pre-#4499 / main layout (NON-BUG IDENTICAL pins ang/r within 1e-9), making the fix safe-by-construction for every non-bug chart.
- The water-fill floor is exact after one pass (surplus > deficit on the reachable branch); the 60-pass loop and renormalise are defensive rounding guards only.
- Convention #5 (one derivation of one fact) handled: ORG_LINE_MARGIN single source; FLOOR FORMULA PINNED test pins orgPlace's floor and orgPlaceGated's ceiling to the identical expression.
- Test controls real and non-vacuous: planted-5px, pairs>5000, checked>=14, funded>0, asserted>=2, multiAsserted>=1, funded-reaches-margin.
- The four sibling-test lift edits are necessary (orgPlace references the module-scope constants unconditionally) and complete.
