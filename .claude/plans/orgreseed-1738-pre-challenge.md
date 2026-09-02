---
pre_challenge: true
method: challenge-loop
branch: orgreseed-1738
diff_hash: e9c4c07401104409e66af9da041b69b65e232ac9b144c38623951c0c0369c967
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T17:38:20Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 produced zero BLOCKERs/WARNINGs/CONVENTIONs)
**Total findings:** 2 actionable WARNINGs (both iter 2) + 5 NITs
**Fixed:** 2 WARNINGs (by simplifying to settle-only) | **Deferred:** the NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (validation baseline)
Full suite green EXCEPT peer-contention flakes: three concurrent peer
`tools/browser-checks.sh` release runs made `test-browser-run-guard.sh` refuse
(documented "run on an idle box"; "green alone is contention, not the change").
Not a code defect. Re-validated once the box idled.

#### Iteration 2 (first blind review)
**New:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
- [WARNING] the sameFleet fresh-seed was all-or-nothing, so any membership change
  re-seeded every node from orgPlace and re-animated the whole MOTION chart -- a
  behaviour change beyond the reduced-motion fix.
- [WARNING] the fresh-seed half had zero test coverage (reverting it passed every
  test).
- Both resolved the same way: DROPPED the fresh-seed (the reviewer's own
  less-disruptive alternative). It was redundant -- the settle (reduced-motion)
  and orgLiveRun (motion) both converge from ANY seed, so a stale seed only
  affects the transient animation, not the final layout. Kept per-key ORG_POS
  seeding unchanged; the fix is now purely the reduced-motion settle.

#### Iteration 3 (second blind review) -- CONVERGED
**New:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
Five STRENGTHs, verified empirically by the reviewer: the motion path is
byte-identical to origin/main apart from moving orgLiveSync into the else branch;
orgLiveSettle terminates (hard cap 600 + anneal breaks ~259) and cannot leave
ORG_LIVE inconsistent; the guard reds on revert on BOTH axes (wiring regexes fail
on origin/main; ORG_SETTLE_STEPS=0 reds the behavioural arm); and there is no
regression -- web.org-view.test.js's 18 tests still pass and orgStep is unchanged.

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 2 | WARNING | sameFleet fresh-seed re-animates whole motion chart | FIXED (dropped) |
| 2 | 2 | WARNING | fresh-seed half untested | FIXED (dropped -> nothing to test) |
| 3 | 3 | NIT | node test hand-copies the anneal rather than driving orgLiveSettle (DOM-coupled) | DEFERRED |
| 4 | 3 | NIT | extractFn brace-counter is string/comment-naive (fails loudly; safe for these fns) | DEFERRED |
| 5 | 3 | NIT | orgLiveSettle is O(n^2)/step synchronous (fine at ~18 nodes) | DEFERRED |

### Deferred (tracked, not silent)
- A render-org-chart.js reduced-motion overlap arm: carded #1870 (owned by
  Renet). The flat runner fixture (5 agents, 0 static overlaps) cannot reproduce
  the defect, so a naive arm would be vacuous; a denser fixture would break the
  fill-band assertion. The node guard already reds on a revert, which is the
  requirement; the browser arm is belt-and-suspenders.

### NITs
- test anneal is a hand-copy of orgLiveSettle's schedule (DOM-coupled fn);
  extractFn brace-naive but fails loudly; orgLiveSettle O(n^2)/step (fine at scale).

### Strengths
- The reduced-motion accessibility defect (permanent overlap, no interaction
  clears it) is resolved: reduced motion now LAYS OUT (settles synchronously)
  instead of skipping the sim. Reduced motion means do not ANIMATE, not do not
  LAY OUT.
- Collision math (orgStep) UNTOUCHED per Baron's measurement that it converges;
  the fix is seeding/wiring only.
- Deterministic node guard lifts the REAL orgStep, reds on revert on both axes.
- Motion path provably unchanged; no regression to web.org-view.test.js.
