---
pre_challenge: true
method: challenge-loop
branch: treefit-3217
diff_hash: 34e147f5c87920e8de9b44a5d59e10afb541bdb18bddf85a98ac7834de230fe6
validation: passed
subdir_audit: passed
timestamp: 2026-09-17T20:39:06Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (blind passes alternating Sonnet/Opus)
**Converged:** Yes (pass 6 Opus CLEAN; pass 5 Sonnet's own verdict was already "mergeable, note not block", and this ends on an Opus CLEAN with the loop's convergence witnessed across both models)
**Total findings:** 0 BLOCKER, 5 WARNING, 0 CONVENTION, several NIT
**Fixed:** all WARNINGs | **Deferred:** the pass-6 NITs (non-behavioral) | **Asked:** 0

Two Josh-directed view-cleanup fixes, batched: #3217 the Projects Map scales to fit the panel width
(no horizontal overflow) via CSS `zoom`; #3222 org-chart agent names are hover-only for every count.
Node suite 7798 tests, 0 fail; #1720 + #2518 gates green (bc-surface-map 0 FAILED). The fit function
is subtle (zoom + measure-timing + scrollbar + boundary), so it drew a WARNING on several passes;
each was a genuine, decreasing-severity robustness improvement, all fixed + guarded + positive-
control-proven, ending on a clean Opus pass.

### Per-Iteration Breakdown

#### Iteration 1 (Sonnet)
- [WARNING] pjMapFit reset zoom before the measurable-check, so an off-tab poll repaint (panel
  display:none -> clientWidth 0) wiped a correct fit and a tab-return re-showed the overflow -->
  FIXED: bail before touching zoom; added an off-tab regression arm.

#### Iteration 2 (Opus)
- CLEAN. [NIT] reset-before-measure could wipe on a visible-but-0 frame --> FIXED (read/bail on
  clientWidth<=0 before reset). [NIT] comment inverted clientWidth --> corrected.

#### Iteration 3 (Sonnet)
- [WARNING] avail read before the zoom reset reflected the previous zoom's scrollbar state, not the
  natural one, risking residual overflow in a narrow band --> FIXED: read avail AT natural size;
  added a deep+wide (vertical-scrollbar) convergence arm.

#### Iteration 4 (Opus)
- [WARNING] test-quality: after the clientWidth bail, the offsetParent guard was redundant for
  #pj-map (not position:fixed), so the off-tab arm could not fail on reverting the guard it named
  --> FIXED: removed the redundant offsetParent guard, retargeted the arm to the clientWidth bail
  (proven it reds on that guard's revert).

#### Iteration 5 (Sonnet)
- [WARNING] the one-shot correction landed the wide fleet exactly at the +1px tolerance edge
  (fragile) --> FIXED: bounded correction loop (<=3 passes) lands at clientWidth, zero residual.
- [WARNING] no reversibility coverage (previously-fit -> now-fits -> un-fit) --> FIXED: added a
  reversibility arm asserting zoom clears when a fleet shrinks to fit.

#### Iteration 6 (Opus)
- CLEAN. No BLOCKER/WARNING/CONVENTION. Verified the bounded loop terminates + converges (monotone
  shrink, hard cap 3), idempotent across polls, no div-by-zero, all test arms non-vacuous. 2 NITs:
  the `nameAtRest=false` always-false ternary branch (intentional documented seam) and a self-
  healing off-tab data-change transient (one poll of overflow on tab-return only if project data
  changes while off-tab; reviewer: "not worth blocking, self-heals, matches accepted posture") -->
  DEFERRED, both non-behavioral.

### Final Ledger
All 5 WARNINGs fixed and re-verified; the fit has a comprehensive measure-timing treatment (hidden/
off-tab/unmeasurable bail before any reset, avail read at natural size, bounded correction loop,
reversibility). render-projects-map.js: 7 non-vacuous #3217 arms (overflow precondition, scaled,
fits-after, off-tab-preserves, deep+wide converges, un-fit reverses) + existing map coverage.
web.org-view.test.js: standalone nameAtRest=false guard (28/28). Weakest premise: CSS `zoom` has no
prior precedent in this file (transform:scale is animation-only), chosen because it reflows (the fit
is real + measurable); both Kosmos engines support it; documented inline. Deferred NITs are
non-behavioral (a documented seam + a self-healing narrow transient).

Addresses #3217, #3222
