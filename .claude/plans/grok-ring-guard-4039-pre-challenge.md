---
pre_challenge: true
method: challenge-loop
branch: grok-ring-guard-4039
diff_hash: 702a65d3d3bad55ef74915c953a9b8d3f544eca8ee358ed645b8b73836e7d90d
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T04:23:10Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6, opus: NO NEW FINDINGS; confirmed across two models: iteration 5 sonnet had no BLOCKER/WARN)
**Total findings:** 0 BLOCKERs, 4 WARNINGs, 8 NITs
**Fixed:** 4 WARNINGs, 6 NITs | **Documented:** 1 NIT (the 27-63 ms write-order gap can briefly show the stale estimate on turn 2) plus 1 NIT accepted (iteration 6: the saving is small beside forWorkdir's own reads) | **Asked:** 0

Validation: PASSED (hash 702a65d3d3ba at 2bd0dd212, rebased on main 65f5d9b9d). An earlier run at ae5f6d599 failed only on server.doorflight-1618, a known load flake (#4066, #4073; passed 3/3 alone on the branch). Subdir CLAUDE.md audit rc 0. Reviewer models: opus 1-4, sonnet 5, opus 6.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] the floor fired on ANY single-call last turn; after a compaction an old prompt pins the ring --> FIXED (first and only turn)
- [WARNING] the new JSDoc sat between read()'s doc and read() --> FIXED (moved above)
- [NIT] test header gave the pre-floor figure as the result --> FIXED
- [NIT] contextUsedAt from signals.json while the value may come from usage.json --> FIXED in iteration 2 (measured order)

#### Iteration 2 (opus)
- [WARNING] the modelCalls check had no test (two-turn fixture short-circuited) --> FIXED (one-turn two-call fixture, 80292)
- [NIT] write order asserted, not measured --> FIXED (measured: usage.json 27-63 ms before signals.json)

#### Iteration 3 (opus)
- [WARNING] the turn-count check had no test on its own --> FIXED (first turn single-call, later turns, compaction)
- [NIT] brief stale read in the write gap --> DOCUMENTED
- [NIT] resume in a new process unmeasured --> FIXED (measured: `grok -r` appended to the same usage.json)

#### Iteration 4 (opus)
- NO NEW FINDINGS; [NIT] `last` holds the only turn --> FIXED (renamed `only`)

Mutation-checked by me after each round: dropping modelCalls, the turn-count check, the `> used` comparison, or the floor each reds a named test.

#### Iteration 5 (sonnet)
- NO BLOCKER/WARN; [NIT] usage.json parsed on every poll for a session's whole life --> FIXED (PAST_FIRST_TURN: sessions seen past turn 1 are not re-read; test with a control, perturbation reds it)

#### Iteration 6 (opus)
- NO NEW FINDINGS on the cache (a reused folder can only fall back to Grok's own figure); [NIT] the cache survived the tests' reset() --> FIXED (clearFirstTurnCache); [NIT] the saving is small --> ACCEPTED
