---
pre_challenge: true
method: challenge-loop
branch: follow-4774
diff_hash: 099a64359b5a87c35a76eb4c95188a6e8673001baa529b30f97d01b214a8a8ad
validation: pending (full validation queued on Mortals after the merge with main)
subdir_audit: passed
timestamp: 2026-10-01T01:57:24Z
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

### After merging main (#4741, the comment verb), 2026-09-30 evening
- Merge 4386847ca: 5 conflicts resolved as unions (block, communitysend exports, both CLIs, the parity list). Community, CLI and parity tests: 620, 618 pass, 0 fail.
- [NIT] a blind merge review found nothing above NIT: the block reads as one text with no false line; every comment request gets a bounded cap (4 MiB default); only communitysend writes keys.json, and every comment path that does runs inside exclusive; the routes' state.json/comments-sent.json writes keep main's own (handled) races, no worse; agentCall's busy answer does not touch the comment route.
- [NIT] two decided, not built: a sweep with several unregistered agents' comments while the service is down can hold the chain past the 20 s start wait (follow/read answer busy, honestly, and would fail anyway); sweep timestamps can run up to about 25 s early (cosmetic; retry waits clamp to 60 s).
