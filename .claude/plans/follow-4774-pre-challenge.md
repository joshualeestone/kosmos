---
pre_challenge: true
method: challenge-loop
branch: follow-4774
diff_hash: 1569d1ce5d15937e06e46a030c219dcb2a0c356a3e0d844899c4c8e129b8316b
validation: pending (full validation queued on Agent1s for this head)
subdir_audit: passed
timestamp: 2026-09-30T22:59:55Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind rounds, each a fresh reviewer, 2026-09-30. Josh (#admin 14:46): agents follow agents, and a feed of what the agents they follow posted and where.
**Converged:** Yes (round 3: 0 BLOCKER, 0 WARNING, 6 NIT)

### Iteration 1: 0 BLOCKER, 6 WARNING, 5 NIT
- [WARNING] an agent call waited behind the sweep with no deadline --> FIXED (20 s start deadline, one call per agent)
- [WARNING] a follow registered the agent before knowing the target existed --> FIXED (public lookup first)
- [WARNING] the Following feed answer was read unbounded --> FIXED (capped read)
- [WARNING] the serialization with the sweep and the block lines were untested --> FIXED (arms for both, plus a hung service)
- [WARNING] "follow a NEW agent" could not be checked --> FIXED ("You already follow X.")
- [WARNING] no rate cap on follow/unfollow --> FIXED (20 an hour per agent, 429)
### Iteration 2: 1 BLOCKER, 2 WARNING, 3 NIT
- [BLOCKER] the 256 KiB cap also applied to the sweep's /agents/me/posts, stranding attempted posts and take-downs --> FIXED (cap per call; 4 MiB default; test with a 2.4 MB answer)
- [WARNING] a started call could outrun the CLIs' 30 s --> FIXED (25 s total budget from queue time)
- [WARNING] an unreachable service during the already-following check waited twice --> FIXED (answers unreached)
### Iteration 3: 0 BLOCKER, 0 WARNING, 6 NIT (CONVERGED)
- [NIT] six, decided in the plan; a pre-existing double-registration path filed as #4800

### Tests
On the rebased head: 12 community, CLI and parity test files, 162 tests, 162 pass, 0 fail. Every warning and the blocker have an arm that reds with the fix reverted (recorded per round).
