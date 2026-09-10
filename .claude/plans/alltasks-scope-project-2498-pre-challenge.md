---
pre_challenge: true
method: challenge-loop
branch: alltasks-scope-project-2498
diff_hash: 7215880bba04303b12a990f7108fe33c22345943c591385840762f5d411f74ce
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T20:29:39Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (the 6.0 fix-and-validate pass counts as iteration 1, then three blind reviews)
**Converged:** Yes (iteration 3 blind review found 0 BLOCKER/WARNING/CONVENTION), witnessed by two models
**Total findings:** 0 BLOCKERs open, 3 WARNINGs (iter1) + 3 BLOCKERs + 1 WARNING + 1 CONVENTION (iter2) + 1 NIT (iter3), all resolved; plus NITs
**Fixed:** all actionable | **Deferred:** 0 | **Asked:** 0

Scopes the project view's "view all tasks" door (`#pj-alltasks` -> `openAllTasksView` -> `/api/tasks`)
to the current project instead of listing every project's tasks (Ben's 0.6.48 finding, Josh #2498).

### Per-Iteration Breakdown

#### Iteration 1 (the 6.0 initial validation pass)
**Reviewer model:** n/a (validation helper)
**New findings:** 1 BLOCKER (synthetic)
**Self-generated:** the finding is a helper failure, Origin BRANCH by instruction
- [BLOCKER] initial-validation: web.alltasks-1382.test.js pinned the pre-scope copy ("No tasks on any project yet") and my scope change broke it --> FIXED (4717fd19): updated the static test to the scoped copy ("on this project") and added a #2498 source assertion (the door carries ?project=PJ_CURRENT).

#### Iteration 2 (first blind review)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (the stale comments pre-existed; my scope change made them stale)
- [WARNING] web/index.html openAllTasksView docblock header / click-listener docblock / a tasks-column history block still claimed the old every-project behavior --> FIXED (51843fc1): corrected all three to the scoped behavior (test-guarded, so a corrected description not new speculation).
- [NIT] the dynamic description rendered a bare project name --> FIXED: reads a sentence ("In <Project>.").
- [NIT] falsy-PJ_CURRENT path copy/global inconsistency --> ACCEPTED: unreachable (door gated on a project view), documented.

#### Iteration 3 (second blind review, different model)
**Reviewer model:** sonnet
**New findings:** 3 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (more pre-existing stale comments; the value of the model switch - it caught what the same-model iter-2 sweep missed by pattern-matching, kosmos#2032 and kosmos#120 both borne out)
- [BLOCKER x3] the server route docblock, the entry-point HTML comment (x2 rationale), and a paintProjectTasks block BETWEEN two iter-1 fixed --> FIXED (1351adf1) by an EXHAUSTIVE grep-driven sweep of both files (fix-the-class, not pattern-match): every all-tasks-door stale claim corrected, true conclusions kept, only now-false reasons changed.
- [WARNING] the always-show rationale assumed a global destination --> FIXED: folded in that a new empty project now shows an empty scoped door, handled by the "No tasks on this project yet" empty-state.
- [CONVENTION] server.tasks-all-1382.test.js header documented only the global mode --> FIXED: documents both modes.
- [NIT] plan overstated "rather than fetching the global set" --> FIXED: the route BUILDS allTasks() then filters the SERVED set; the win is on the CLIENT.

#### Iteration 4 (third blind review)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] the docblock said "No caller fetches the global set" but getDue (a test) does --> FIXED (b1d5c75f): "No UI screen fetches the global set today", naming the test consumer.
**Converged** - the stale-comment sweep confirmed clean; server filter, backward-compat, injection-safety and failable test controls all verified.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.alltasks-1382.test.js:73 | BRANCH | static test pinned pre-scope copy | FIXED | 4717fd19 |
| 2 | 2 | WARNING | web/index.html (3 docblocks) | BRANCH | stale every-project claims | FIXED | 51843fc1 |
| 3 | 3 | BLOCKER | server.js:8612 + web/index.html:10139,32356 | BRANCH | more stale every-project claims (exhaustive sweep) | FIXED | 1351adf1 |
| 4 | 3 | WARNING | web/index.html:32356 | BRANCH | always-show rationale assumed global | FIXED | 1351adf1 |
| 5 | 3 | CONVENTION | server.tasks-all-1382.test.js:4 | BRANCH | header documented one mode | FIXED | 1351adf1 |
| 6 | 4 | NIT | server.js:8614 | SELF | "No caller" imprecise (a test calls it) | FIXED | b1d5c75f |

### Outstanding questions (ASKED)
None.

### NITs
- falsy-PJ_CURRENT copy/global inconsistency (unreachable, documented) - accepted.

### Strengths (across iterations)
- Server filter correct + safe: try/catch-parsed ?project=, strict equality, unknown id -> empty (no global fallback), closed tasks kept per project (preserves #1382 finished-work purpose).
- Backward-compat load-bearing, not just asserted: the no-param global path keeps the getDue consumer working; tested with a control.
- Every negative test assertion paired with a control proving it can fail; static-test change tightened not loosened.
- Frontend injection-safe (encodeURIComponent, textContent).
- The plan resolves the #1382-global vs #2498-scoped standing-ruling conflict explicitly and preserves the #1346 no-count rule.
- The model rotation (opus/sonnet/opus) demonstrably earned its keep: the sonnet pass caught stale comments the same-model iter-2 sweep missed.
