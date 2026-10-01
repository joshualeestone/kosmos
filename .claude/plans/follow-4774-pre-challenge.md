---
pre_challenge: true
method: challenge-loop
branch: follow-4774
diff_hash: dd50b9c4fbcdd105b60b8e5e77ca7bba48eb906c2d3d21f8729948b322df2a92
validation: passed (full suite on Agent1s at 09c911cee, 23:46 CDT: 13199 pass, 0 fail; validation-log hash dd50b9c4fbcd)
subdir_audit: passed
timestamp: 2026-10-01T04:46:21Z
iterations: 7
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

## Re-review after c1218c4f8 (two EXCUSED test seams in engine.reachable.test.js) and the merge of main f3feaed8f

### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 2 WARNING, 1 CONVENTION, 3 NIT
**Self-generated:** 0 of the above
- [WARNING] engine/communityfollow.js:56: the hourly cap counts an attempt answered busy --> DEFERRED: decided in round 1 (every validated attempt counts); about one follow every three days makes 20 busy answers in an hour unreachable
- [WARNING] engine/communitysend.js:174: the sweep queues behind agent calls; asked for a comment --> duplicate of round 3's decided NIT (sweep and chain); a new prose comment is the self-regenerating class
- [CONVENTION] .claude/plans/follow-4774.md: no timestamp in the plan name --> DEFERRED: the PR hook requires .claude/plans/<branch>.md and every plan in the directory uses that form
- [NIT] agentCall's given-up closure stays queued and returns null (already commented "never runs later")
- [NIT] communityfollow's recent map is never pruned (bounded by the agent count)
- [NIT] the already-following check depends on the stored name matching the public one (fails safe; the plan's weakest premise)

### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 4 NIT
**Self-generated:** 0 of the above
- [WARNING] engine/communitysend.js:733: an owner's delete or take-down can go out late behind queued agent calls --> DEFERRED and written into the plan (3c70c4a80): one call per agent (agentsInCall), each held to 25 s, so the worst delay is agents x 25 s on an action that still goes out; changing code under a running full validation for a near-zero case at this fleet's size
- [NIT] sweep's now is fixed at call time, not start time (cosmetic; retry waits clamp to 60 s) --> recorded in the plan
- [NIT] community follow --help follows "--help" --> left for the reply-rules follow-up PR
- [NIT] the no-account line prints inside the read-not-obey frame --> recorded in the plan
- [NIT] the plan's "Decided, not missed" placeholder was empty --> FIXED (3c70c4a80, plan only)

### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER, 1 WARNING, 0 CONVENTION, 4 NIT
**Self-generated:** 0 of the above
- [WARNING] engine/communitysend.js:739: keys.json may have writers outside exclusive(), so the header comment overstates --> DEFERRED, measured not an issue: all 15 saveJson(keysFile()) calls are in helpers reached only from sweepOnce (one call site, inside exclusive at :733) or agentCallSteps (via agentCallNow, one call site, inside exclusive at :797); neither is exported; requestDelete, markNotSent and recordPeriodStart write deletes.json / comments-sent.json / state.json, not keys.json
- [NIT] the 429 wording counts attempts that never reached the service
- [NIT] a repeat follow is not detected when beforeCall is skipped (empty me or tight budget)
- [NIT] follow --help (as iteration 5)
- [NIT] communityblock.js says the comment verb exists while the plan said it was open --> FIXED in the plan (09c911cee, plan only): the verb merged in #4741

### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 5 NIT
**Self-generated:** 0 of the above
**Converged:** no new actionable findings.
- [NIT] the hourly cap counts attempts refused locally (switch off) before the switch is checked
- [NIT] follow --help (as iterations 5 and 6)
- [NIT] the no-account line inside the frame (as iteration 5)
- [NIT] a register:false read still waits behind a full sweep (correct, more serial than needed)
- [NIT] communityread.js's doc comment above readCapped still describes the streaming body now in communitysend.js

Validation for this re-run: the full suite on Agent1s at 09c911cee, the head this proof covers (moved off Mortals for the 0.7.15 cut): 13199 pass, 0 fail.
