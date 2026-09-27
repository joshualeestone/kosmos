---
pre_challenge: true
method: challenge-loop
branch: orgline-4040
diff_hash: 28740bcd68f79f9fbaee3480bf195965874991e7b79e2ad03c51cbe4d84f5b9a
validation: failed (deferred by the author: the final run was red on one unrelated timing test, #1618 shelf doors, under machine load 50 to 70; green alone and green on CI for #4058 the same evening; CI on a clean runner must be green before merge)
subdir_audit: passed
timestamp: 2026-09-27T00:49:59Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 reviewer passes
**Converged:** Yes, at iteration 6 (no new BLOCKER, WARNING or CONVENTION; its one CONVENTION repeats a deferred one)
**Total findings:** 14 actionable (0 BLOCKERs, 12 WARNINGs, 2 CONVENTIONs), plus NITs
**Fixed:** 11 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Validation, stated as it happened

- 6g after iteration 5: red on the browser-check surface gate (the token `onode` in a comment touches
  render-dm-badges-2863.js). Answered with a per-check trailer, and that check was RUN green on this
  branch alongside render-swarm-ui-3564 and render-org-drag.
- Before the final gate the branch was found to conflict with main (the swarm check's surface header,
  after #4058 merged); resolved by keeping main's ids plus `orgmap`. On the merged tree the swarm check
  passed all 84 arms, #3946's and this card's together, with render-org-drag and render-dm-badges-2863.
- 6j (final): red on `#1618: two callers asking for the shelf at once verify each door ONCE`
  (server.doorflight-1618.test.js), a file this branch does not touch. The same test was red twice on
  #3946's final runs the same evening, passed alone every time it was rerun, and passed on CI for #4058.
  Deferred by the author, not looped again: no change in this branch can affect it. CI green is the gate.
  Weakest premise: that it is contention. CI red on it would overturn that.

### Per-Iteration Breakdown

The Self-generated line is recorded as not measured: the 6c-bis blame lookup was not run, and this
field must not be filled in by judgement.

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** not measured
- [WARNING] web/index.html a fixed 32px reach assumed corner circles; they sit on a ring --> FIXED (measured from swarmLayout) ae6598e4
- [WARNING] plan/comment derivation of 32px was wrong --> FIXED ae6598e4
- [WARNING] S40 hard-coded the code's own constant --> FIXED (measures drawn circles) ae6598e4
- [WARNING] S40 could measure the flat ring before the branch arrived --> FIXED (waits for the drawn branch) ae6598e4
- [CONVENTION] new helpers orphaned the #1738 comment --> FIXED ae6598e4

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION
**Self-generated:** not measured
- [WARNING] one reach per cluster left a two-helper cluster's wire about 13px short --> FIXED (cut along the wire's direction) 9da9230c
- [WARNING] S40 checked only the child end --> FIXED (both ends; a two-helper crew2) 9da9230c
- [CONVENTION] plan filename lacks a timestamp --> DEFERRED (the PR hook requires .claude/plans/<branch>.md, as every plan in the repo is named)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [WARNING] S40 teardown did not wait for the poll that undoes its branch --> FIXED 073067e9
- NITs taken: drag check asserts the near side; a grazing wire stops at the circle's outer edge 073067e9

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** not measured
- [WARNING] a 3 to 5 helper ring gets a near-uniform cut --> DEFERRED (by design: the wire ends at the cluster's outline, which is the avatar's edge the card asks for; written in the plan)
- [WARNING] the geometry had no sweep test --> FIXED (web.org-wire-ends-4040.test.js, every helper count at every degree; two mutations red) 44f063be
- [CONVENTION] raw 44/22 literals --> FIXED (ORG_FACE_PX) 44f063be

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [WARNING] paintOrg and orgReach each had their own swarm test --> FIXED (orgDrawsCluster, pinned by a test) 9c1c0733
- NITs taken: comment re-wrapped; layout cache keyed on the drawn count; S40 checks only the discs at a wire's own ends 9c1c0733

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 new CONVENTIONs (the plan-filename one repeats iteration 2's deferral), 2 NITs
**Self-generated:** not measured
**Converged** -- no new actionable findings.

### Final Ledger (actionable only)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | not measured | 32px corner-circle reach | FIXED | ae6598e4 |
| 2 | 1 | WARNING | plan | not measured | wrong derivation in prose | FIXED | ae6598e4 |
| 3 | 1 | WARNING | render-swarm-ui-3564.js | not measured | S40 used the code's constant | FIXED | ae6598e4 |
| 4 | 1 | WARNING | render-swarm-ui-3564.js | not measured | S40 raced the flat ring | FIXED | ae6598e4 |
| 5 | 1 | CONVENTION | web/index.html | not measured | orphaned #1738 comment | FIXED | ae6598e4 |
| 6 | 2 | WARNING | web/index.html | not measured | isotropic reach | FIXED | 9da9230c |
| 7 | 2 | WARNING | render-swarm-ui-3564.js | not measured | child end only | FIXED | 9da9230c |
| 8 | 2 | CONVENTION | plan filename | not measured | no timestamp suffix | DEFERRED | hook requires <branch>.md |
| 9 | 3 | WARNING | render-swarm-ui-3564.js | not measured | teardown race | FIXED | 073067e9 |
| 10 | 4 | WARNING | web/index.html | not measured | near-uniform cut on small rings | DEFERRED | by design, in the plan |
| 11 | 4 | WARNING | tests | not measured | no geometry sweep | FIXED | 44f063be |
| 12 | 4 | CONVENTION | web/index.html | not measured | raw literals | FIXED | 44f063be |
| 13 | 5 | WARNING | web/index.html | not measured | two swarm predicates | FIXED | 9c1c0733 |
| 14 | 6j | BLOCKER (synthetic) | final-validation | BRANCH | #1618 red under load | DEFERRED | unrelated file; CI is the gate |

### NITs (non-blocking, open)
- the clamp `Math.max(2, Math.min(10, ...))` is now in three places (pre-existing pattern in swarmCircles/swarmCluster)
- S40's branch shape maps (`{ rex: 'crew', crew2: 'rex' }`) must change with the fixture
- no cluster-to-cluster orgWireEnds unit case (each end is cut independently by the swept orgReach)
- the hub's reach 0 relies on the hub staying opaque

### Strengths
- The cause was found rather than assumed: z-order was never the mechanism, so the card's suggested
  elementFromPoint check could not fail; the plan records why
- One helper writes every wire, on the first render and on every live frame
- S40 measures what is drawn, and a scratch mutation with centre-to-centre wires turned it red
