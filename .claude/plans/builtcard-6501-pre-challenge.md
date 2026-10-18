---
pre_challenge: true
method: challenge-loop
branch: builtcard-6501
diff_hash: 962e55c7415d778f7de411a56bf304917f19b32e3e07cd10d8f3eb5089df2d8c
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T19:35:13Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (fresh blind agents: Opus, then Sonnet)
**Converged:** Yes. Round 2 found no BLOCKER or WARNING.
**Validation:** passed at ed71991884 (hash 962e55c7415d): 21,955 node tests, 0 failed; shell shard 252/252.
**Browser checks:**
- render-tasks: the #6501 arm passes. On main it fails, where the built card read "TASK 6 / Nobody yet".
- render-newlook-4470: 347/347.
- render-shell-noscroll-4872: 72/72 (the surface gate named it).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] a task held after it was marked built said built (the engine's taskState: hold wins) --> FIXED: builtOpen excludes onHold; test with a pre-control that the held task is drawn
- [WARNING] the built line sat under one agent's name, so it read as that agent built it (the person or another agent may have marked it) --> FIXED: its own line (.tkcard-built), claim dropped
- [NIT] nobody assigned, or no claim, showed nothing --> FIXED by the same own line (test covers nobody assigned)
- [NIT] the new look hides the label --> the own line is visible there
- [NIT] a comment on the repeat line was misplaced --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- No new BLOCKER or WARNING. It checked the change guard, the consolidated layout, the other tests, and the paused-project case.
- [NIT] the new look styled the built line differently from the claim line --> FIXED: same rule
- [NIT] the comment named only one claim form --> FIXED: all three
