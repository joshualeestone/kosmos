---
pre_challenge: true
method: challenge-loop
branch: tips-pass2-3755
diff_hash: 54af2c558bc8ab92acc3ea6a7758c4e48fcb40d23c611bbccfd0084eeb5b3670
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T19:56:48Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 had nothing at WARNING or above)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs (iteration 1); 0 at WARNING or above (iteration 2)
**Fixed:** 2 WARNINGs, 3 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] A new agent has no memory reading on its first visit, so the agent page's tips run without the ring step
  and record 'agentpage': the ring explainer would never be seen. Fixed: 'ring' keeps its own id; the ring step records
  it (alsoSeen) only when shown on its place; otherwise the ring's explainer shows by itself, beside the ring, the first
  time her page draws one (T3c, T3e; T34 asserts both ids recorded).
- [WARNING] The branch sat on a stale #3737 base missing the one-colour gutter fix. Fixed: rebased; tipDimmedGround and
  the data-tip-ground rule verified present.
- [NIT] Stepped tips take focus and close on any outside click or Escape, like the tour. Taken as a documented decision
  in the plan (the page is dimmed; a click ends them).
- [NIT] T15 may pass without its blur line (the engine blurs a hidden card's focus). The arm now says it checks the
  outcome, focus on the page and not on another control.
- [NIT] openRingTip and the T14 create-form stand-in are screen tips no product screen now shows; kept for tipPlace's
  screen-tip rules (Agents and Projects tips use them), said in the helper's comment.
- [NIT] A step's target below the fold was not brought into view. Fixed: scrolled into view once as the step opens.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs
**Self-generated:** 0
Verified: TIPS order makes agentpage win over the standalone ring on her page (no double show); alsoSeen is recorded only
for a shown step; T16 generalised with no stale `.tour`; scrollIntoView runs once per step, not per relayout; T3e and
T34's seen assertions trace against tipClose; tips.test's two-lists cross-check matches the table.

## After convergence
- The first 6j caught a real red: the check's surface list still named the removed ? ids (the surface map refuses
  tokens with no real occurrence). Fixed in the check's header.
- Rebased onto main after #3737 (#3772), #3758 (#3776) and #3690: conflicts with #3739's guide-aware new-board count
  (both kept: id === 'tour' and the isGuide filter) and the README rows; the rewritten commit subjects kept.
- The surface gate named four checks whose ids the tips point at; each run green on this branch and recorded in
  per-check trailers (render-project-members-3387 40, render-agentpage-fullwidth-2012 5, render-detail-ring-1915 11,
  render-user-menu-3051 72).

## Validation
6j on HEAD: full suite clean (hash 54af2c558bc8), subdir audit clean. render-help-tips-3574: 120 pass, 0 fail, on
today's main. engine/tips.test.js passes.
