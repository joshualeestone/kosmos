---
pre_challenge: true
method: challenge-loop
branch: sandboxlogin-8050
diff_hash: b32ddd0b7acddbb2c47ec9032eca6c440c4f351428fe0d1f26f6ad16405c06f1
validation: passed (Mortals: mortals-validate on fdae2f6069, status clean, hash b32ddd0b7acd, full suite)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-11-05T21:50:03Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the cap: Splinter's usage rule of 2026-10-22 11:08, past 8 rounds only while a BLOCKER is open. None was raised.
**Asked (awaiting user):** 0

**Not reviewed by a blind round:** the last commit (a test arm made conditional, a comment moved, a plan line).

### Per-Iteration Breakdown
#### Iteration 1 (opus)
- [WARNING] "covers them all" overstated: only this script sets the variable, and a real `claude` reads its own login --> FIXED: narrowed, listed in the plan, corrected on the card
- [CONVENTION] connect.js comment stale --> FIXED
- [NIT] whitespace read as 1970; PATH not isolated; a midnight date --> FIXED
#### Iteration 2 (sonnet)
- [WARNING] no guard on a leaked variable --> rejected at first, reversed in iteration 4
- [NIT] comment and fixture drift --> FIXED
#### Iteration 3 (opus)
- [WARNING] "green" proves nothing: it also passes with a fresh login --> FIXED: the plan names a control that can fail
- [CONVENTION] a false sentence about sb1 --> FIXED
- [NIT] the "only two readers" claim unguarded --> FIXED: a sweep
#### Iteration 4 (sonnet)
- [WARNING] a leak shows a false date; my reason for rejecting a marker was wrong --> FIXED: a sandbox home is required
#### Iteration 5 (opus)
- [WARNING] the real home named as the sandbox passed (self-generated) --> FIXED
- [WARNING] the plan's control could not run as written --> FIXED
- [CONVENTION] "an existing check would show it" was false --> FIXED
#### Iteration 6 (sonnet)
- [WARNING] os.userInfo throwing broke "never rejects" (self-generated) --> FIXED
#### Iteration 7 (opus)
- [WARNING] text comparison missed a link or another spelling of the real home (self-generated) --> FIXED: real paths
- [WARNING] behaviour unmeasured --> stated: the card stays open until the plan's step 3 runs
#### Iteration 8 (sonnet)
- [WARNING] the case arm could fail on another volume --> FIXED: it runs only where the spelling resolves to the same real path

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### Strengths
- Both keychain readers go through one helper, and every bad path answers nothing, never the real read
- The fake `security` is the only thing on PATH, and a control proves it runs
