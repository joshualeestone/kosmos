---
pre_challenge: true
method: challenge-loop
branch: working-pulse-3956
diff_hash: c035c94cbf67028282255ca16f7c068c4ba5f56ce03e1cb9a6641478ebaab2c3
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T14:44:22Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 23 (1 BLOCKERs, 8 WARNINGs, 0 CONVENTIONs, 14 NITs), plus 2 synthetic validation findings
**Fixed:** 7 | **Deferred:** 3 | **Asked (awaiting user):** 0

6.0 was not run as a separate pass: the full suite had just run on the committed tree, and iteration 1's
reviewer ran alongside the first validation. Validation then failed twice between iterations
(synthetic findings S1, S2 below), each fixed and committed before the next pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (no loop commits existed)
- [BLOCKER] web/index.html:2243 - the 5s poll rebuilds cards, restarting the animation at 0%, so the green snapped to white mid-pulse --> FIXED (401fd4e68: pinWorkingPulse via MutationObserver + animationstart backstop; new rebuild arm)
- [WARNING] docs/browser-checks/render-working-pulse-3956.js:108 - the check could not see that snap --> FIXED (401fd4e68: 16s rebuild watch, fails on any frame-to-frame jump; asserts >=2 rebuilds)
- [WARNING] web/index.html:2244 - background-color repaints per frame, not composited --> DEFERRED: known tradeoff, recorded in the plan; the overlay alternative needs position + a stacking context on .acard/.pj-member (menu-trapping risk). The plan's earlier pseudo-element premise was false and is retracted there.
- [NIT] web/index.html:2237 - "ONE animation" comment overstated --> comment rewritten (401fd4e68)
- [NIT] web/index.html:2229 - pill breathe 2.4s vs pulse 3.6s beat
- [NIT] render-working-pulse-3956.js:12 - one-screen variant claimed, not shown
- [NIT] web/index.html:2240 - "never dark, in either theme" untested --> claim removed (401fd4e68)

#### Synthetic (between 1 and 2)
- [BLOCKER] S1 validation: #1387 every browser check must be RUN by the runner --> FIXED (5dbd8c9d9: gated.txt)
- [BLOCKER] S2 validation: web.post-receipt / web.quoteb evaluate the page with no MutationObserver --> FIXED (a2b3b345b: guarded)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (the observer lines are this loop's, but the finding is about scope, a code-shape judgement, fixed by moving it)
- [WARNING] web/index.html:59520 - observer scoped to the whole document --> DEFERRED: callback work is proportional to nodes the page itself just added; scoping to three containers would miss later surfaces. Reason in the plan.
- [WARNING] render-working-pulse-3956.js - one-screen folded layout not measured --> FIXED (9114abfeb: folded-layout arm)
- [WARNING] plan + check - dark and navy themes unmeasured --> FIXED for dark (9114abfeb: dark arm); navy stated NOT measured in the plan
- [NIT] duplicate reduced-motion media blocks
- [NIT] observer constructed after the first tick() --> FIXED (9114abfeb: moved before it)
- [S3] validation: surface gate wanted per-check trailers with the .js basename, plus render-member-modal.js --> FIXED (9114abfeb trailers, member-modal re-run green)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (the reduced-motion ground arm was written by this branch's first commit, not a fix commit; recorded as SELF-adjacent for honesty)
- [WARNING] render-working-pulse-3956.js:200 - reduced-motion ground arm was phase-dependent (could pass on the trough with the rule gone) --> FIXED (faf60eca5: samples a whole cycle; that perturbation now reds 8 arms, README corrected from 6)
- [WARNING] web/index.html:2244 - repaint cost unmeasured --> duplicate of iteration 1's DEFERRED entry
- [NIT] rebuild continuity measured on the grid card only
- [NIT] folded arm cannot distinguish fold-a from the base rule
- [NIT] breathe vs pulse rhythm
- [NIT] dark themes pulse lighter, not darker --> recorded in the plan (faf60eca5)
- [NIT] observer scope (dup of deferred)
- [NIT] a view revealed without a class change relies on the animationstart backstop

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved or deferred):** 2 (navy unmeasured = iteration 2's deferred note; repaint cost = iteration 1's deferred entry)
- [NIT] org chart's existing green glow not mentioned as considered
- [NIT] plan filename has no timestamp (repo-wide practice)
**Converged** - no new actionable findings. A navy screenshot was taken after this pass (subtle teal shift, legible) for the PR, without changing the branch.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html:2243 | BRANCH | rebuild restarts pulse, snaps to white | FIXED | 401fd4e68 |
| 2 | 1 | WARNING | render-working-pulse-3956.js:108 | BRANCH | check blind to the snap | FIXED | 401fd4e68 |
| 3 | 1 | WARNING | web/index.html:2244 | BRANCH | per-frame repaint | DEFERRED | tradeoff in plan |
| S1 | - | BLOCKER | gated.txt | BRANCH | check not wired to runner | FIXED | 5dbd8c9d9 |
| S2 | - | BLOCKER | web/index.html | BRANCH | MutationObserver absent in node page tests | FIXED | a2b3b345b |
| 4 | 2 | WARNING | web/index.html:59520 | BRANCH | observer document-wide | DEFERRED | reason in plan |
| 5 | 2 | WARNING | render-working-pulse-3956.js | BRANCH | folded layout unmeasured | FIXED | 9114abfeb |
| 6 | 2 | WARNING | plan/check | BRANCH | dark/navy unmeasured | FIXED (dark) / DEFERRED (navy stated) | 9114abfeb |
| S3 | - | BLOCKER | surface gate | BRANCH | per-check trailers wrong basename | FIXED | 9114abfeb |
| 7 | 3 | WARNING | render-working-pulse-3956.js:200 | BRANCH | reduced-motion arm phase-dependent | FIXED | faf60eca5 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- pill breathe (2.4s) and ground pulse (3.6s) beat against each other (1, 3)
- duplicate reduced-motion media blocks (2)
- rebuild continuity measured on the grid card only (3)
- folded arm cannot tell fold-a from the base rule (3)
- a view revealed without a class change relies on the animationstart backstop (3)
- org chart green glow not mentioned (4)
- plan filename has no timestamp (4)

### Strengths (across all iterations)
- Only the layer under the static wash animates, mixing into each theme's own surface; hover, fold-a and reduced-motion grounds survive (1, 3, 4)
- Canvas sRGB sampling is the right instrument for a colour computed as oklab mid-animation (1, 3)
- Rebuild continuity measured across real polls on both engines, largest step 1.00 (2, 3, 4)
- The plan retracts its own false premise in place (3, 4)
