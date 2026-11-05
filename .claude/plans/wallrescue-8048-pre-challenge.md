---
pre_challenge: true
method: challenge-loop
branch: wallrescue-8048
diff_hash: 9174b0bd06369cc5d8cc55593e9b5ff4e9b6f260d9387b6a201835f2fc08539a
validation: local only (engine/automove-7548, engine/autobalance-sweep-7152, engine/assigner-failover-5382, engine/autobalance-7152, server.autobalance-7152, server.automove-deps-7621, server.work-marker-2146: 162/162 on 441ca40b3c; node --check server.js); the full suite runs on the PR's CI
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-05T19:33:12Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at 8 under Splinter's rule; no BLOCKER was open at the stop. Round 8 was the whole-branch read with nothing settled (rule 4). Its WARNING and lows are carried to #8056.
**Reviewer models, in order:** opus, sonnet, opus, sonnet, opus, sonnet, opus, sonnet. All blind, whole branch, no plan file.
**Total:** 1 BLOCKER (round 3) fixed; WARNINGs fixed in rounds 1 to 7; round 8's WARNING (Settings copy, Mona Lisa's words) and lows carried to #8056.

### Round 1 (opus)
- [WARNING] a remembered limit reading counted as limited --> FIXED, red when undone
- [WARNING] a rescued agent comes up with its parts and no prompt --> DECIDED: the Prompter's agent nudge covers open parts (reasoned); recorded on #8048
- [low] nowMs not passed; undated fixture not the real shape --> FIXED

### Round 2 (sonnet)
- [WARNING] a restart kills running jobs and drops commitments silently --> FIXED: the move's message says so, with the agent's commitments
- [low] skipped reason "no longer idle" --> FIXED in the record (page copy to #8056)

### Round 3 (opus)
- [BLOCKER] the message filtered for string commitments; real ones are { what } objects --> FIXED, real fixture, red when undone
- [WARNING] most moves off the limit said nothing about the restart --> FIXED
- [WARNING] weekly limit under 24 h from reset prints no date --> RESIDUAL, named in code; measured that the incident's reset was 50 h out
- [low] switched-off swarm --> FIXED

### Round 4 (sonnet)
- [WARNING] stale commitments told as current; an @ could reach the thread --> FIXED (stale handling then revised in round 5)
- [low] fixtures not the real limit line --> FIXED

### Round 5 (opus)
- [WARNING] a pane recovered before its reset reads rate_limited while working --> FIXED: working report after first sighting skips the move
- [WARNING] stale commitments dropped means almost never naming any --> FIXED: said with their age

### Round 6 (sonnet)
- [WARNING] the working marker is written by any prompt, so a stuck agent with traffic looked recovered --> FIXED: a separate 'tool' marker, only the hook's PreToolUse report
- [low] memory survived a switch-off; days phrasing --> FIXED

### Round 7 (opus)
- [WARNING] first sighting at the limit on the moving tick gave no recovery window --> FIXED: two sightings at the limit
- [low] skip line every cycle; memory on other early returns; comment residual --> FIXED

### Round 8 (sonnet, whole branch, nothing settled)
- [WARNING] Settings copy says the mover moves only idle agents --> #8056 item 1 (Mona Lisa)
- [low] x4 --> #8056 items 2 to 5
