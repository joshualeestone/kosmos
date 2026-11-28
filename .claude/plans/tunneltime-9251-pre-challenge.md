---
pre_challenge: true
method: challenge-loop
branch: tunneltime-9251
diff_hash: 182d2a9c03e47d2bc92bd0e7b87c93a4f546989a9c52486d14c36bdda60dc9d7
validation: local on the rebased head f8d743828f: server.phonenotify-718 52/52 (three times before the comment edit, once after) and fixture-discipline green; arms measured: old test with a 700 ms healthy fake red, limit carried over red, turningOn-never-cleared mutant red; the full suite runs on the PR's CI
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-28T02:19:29Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes. Iteration 1 (blind reviewer, whole branch) found no BLOCKER or WARNING; both NITs (comment accuracy) fixed.

Measured before review, each arm red or green as it should be:
- the old test, with the second call made to a healthy tunnel answering in 700 ms: red ("left later turn-ons stuck"), as on Mortals
- the fix, same 700 ms tunnel: green
- the fix with the 500 ms limit carried over: red
- the fix with a mutant whose turnOn never clears turningOn (a real stuck turn-on): red

### Per-Iteration Breakdown

#### Iteration 1
- [NIT] the comment said the tunnel answers after 700 ms on every run; the timer starts before the tunnel is spawned, so a late tunnel can find the gate open --> FIXED: "no sooner than 700 ms after this timer is set"
- [NIT] the comment said a 400 means stuck; a box slower than the 20 s normal limit or a failed spawn could give one --> FIXED: "almost certainly", with the exceptions named
- [STRENGTH] checked clean: the normal limit is 20 s (remote.js); the gate fallback is about 60 s; the gate name is unique and the sandbox fresh; TUNNEL_BIN and the limit are restored in finally; a never-cleared turningOn reds the test
