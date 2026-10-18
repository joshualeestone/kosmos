---
pre_challenge: true
method: challenge-loop
branch: waitonce-6492
diff_hash: f9cce84afdc5f20bc949d3169c894187874b873cc0f45b18abac98aece0a965c
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T17:00:33Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (fresh blind agents: Opus, then Sonnet)
**Converged:** Yes. Round 2 found no BLOCKER or WARNING.
**Validation:** passed at ffb22d4c06 (hash f9cce84afdc5): 21,952 node tests, 0 failed; shell shard 252/252.
**Browser check:** render-tasks-view-3559 passed all checks on the change. On main, its strict #6492 arm fails in all four themes and sizes. The web test's #6492 case fails on main too.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the "another reason keeps both lines" case cannot happen with real data (engine/tasks.js waitingSinceOf sends an age only when every card is NEEDS_YOU, whose reason is always 'question') --> FIXED: the comment says so, and the two-line form is a stated fallback
- [NIT] a count assertion passed on the regression --> FIXED, and checked against main's page
- [NIT] the wording was typed twice --> FIXED: built from PJ_NEEDS_WHY.question
- [NIT] names were de-duplicated by display name --> FIXED: by agent id; andList is not in the page, so ", " is kept

#### Iteration 2
**Reviewer model:** sonnet
- No new BLOCKER or WARNING. It verified round 1's engine claim independently and found PJ_NEEDS_WHY safe at tskRow's only caller.
- [NIT] the tasks-decision shot screen could photograph the old who-only line --> FIXED: it waits on the combined line (both classes)
- [NIT] the wording is spliced from the catalogue string --> kept: the #6492 test pins it, so a copy change fails loudly
