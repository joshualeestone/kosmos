---
pre_challenge: true
method: challenge-loop
branch: sidelock-7420
diff_hash: feef3496080c1d2f6dc5b7805929afc16e82423831b0fa922b2079d3ac0844b8
validation: passed
subdir_audit: passed
timestamp: 2026-10-29T17:13:01Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (iteration 1 the initial validation; iterations 2 to 4 blind reviewers)
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 8 NITs
**Fixed:** 9 | **Deferred:** 2 (reasons below and in the plan) | **Asked (awaiting user):** 0

**Validation of record (HEAD ea493dd64a, on origin/main 76ba6e6fdf):** simulator (iPhone 17 Pro, iOS 27), Debug, a forced sideways shift (KOSMOS_SAMPLE_SIDEWAYS=4) with 30 burst screenshots around it, horizontal offset of a band of bubbles against the first shot: main 1 of 30 shots shifted 18 px in each of 3 runs; this branch 0 of 30 in each of 3 runs at every review round; with the trace on, the shift is still counted ("side offset 16, put back, shift 1") and keepAtEnd still follows new messages. The 82 repo tests that read ios/ pass (11 files). Release build compiles.

### Per-Iteration Breakdown

#### Iteration 1 (initial validation)
**Reviewer model:** none. Measurement above; the sample DM (growing, many reactions, long, working dots, keyboard up and down) shows 0 shifts on main, so the real cause is not in the sample.

#### Iteration 2
**Reviewer model:** general-purpose (blind)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- WARNING fixed: no re-entrancy guard on the write inside its own observer (writing flag; a nested shift falls to the delayed put-back).
- WARNING deferred: an app-started animated scroll (status-bar tap) is neither drag nor fling; a shift landing during it is written at once and may end it early. No public API tells it apart; documented in the comment.
- NITs fixed: comment wording (iOS 16 move "often" animated, the hold named).

#### Iteration 3
**Reviewer model:** general-purpose (blind)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- WARNING fixed: a cause reshifting on every layout pass could trade writes with us every pass; at most 4 immediate writes per 0.35 s window, then the old delayed put-back.
- NITs fixed: comment wording.

#### Iteration 4
**Reviewer model:** general-purpose (blind)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- NIT fixed: the cap is per window, not sliding (comment says 8 across a window edge).
- NIT deferred: the diagnostic's shift count is not comparable with builds 16 and 17 (a recurring cause now counts each recurrence); noted in the plan.
