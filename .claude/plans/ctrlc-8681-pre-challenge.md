---
pre_challenge: true
method: challenge-loop
branch: ctrlc-8681
diff_hash: 64740aae599e8c86a63660eb512014a744ccb3b92416a23e53be0563464423e1
validation: passed
subdir_audit: passed
timestamp: 2026-11-18T03:32:28Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 5 actionable (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs counted as actionable; 1 WARNING deferred), plus NITs
**Fixed:** 4 | **Deferred:** 1 | **Asked (awaiting user):** 0

Initial validation (6.0) was not run before iteration 1: on this fleet a full validation is a heavy queued turn, and
the standing rule is to converge review first, then queue once. Both browser-check gates were run before queueing.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] tools.win-publish-node-bounded-7951.test.js: a failed run leaves pwsh running to its limit and node with no limit (a SIGKILLed pwsh never reaches its own finally) --> FIXED (d456e3123e): the test's finally kills a live pwsh and the node, matched by the run's own pid file; three leaked nodes on the Mac were stopped
- [NIT] pwsh dying at start waited out the allowance --> FIXED; [NIT] pwsh already gone at SIGINT read as an instant stop --> FIXED; [NIT] redundant !killed --> kept for the message

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] the node-gone check used one fixed 300 ms wait, the card's own class --> FIXED (6af3f66dae): polled up to the stop allowance; perturbation (the script's node kill removed) goes red
- [NIT] "Review 1" labels in comments --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] plan: worst passing case stated as 240 s, really about 360 s --> FIXED (352557087d)
- [NIT] comment named the wrong cause --> FIXED; [NIT] ps without -ww --> FIXED; [NIT] leak window before the pid file exists --> accepted

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (deferred), 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured (the 6c-bis blame lookup was not run this loop)
- [WARNING] a test killed from outside skips its finally --> DEFERRED: pre-existing, rarer with a 360 s worst case under the 600 s timeout; recorded in the plan (839f315cea)
**Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools.win-publish-node-bounded-7951.test.js:145 | BRANCH | failed run leaks pwsh and node | FIXED | d456e3123e |
| 2 | 2 | WARNING | tools.win-publish-node-bounded-7951.test.js:162 | BRANCH | fixed 300 ms node-gone wait | FIXED | 6af3f66dae |
| 3 | 3 | WARNING | .claude/plans/ctrlc-8681.md:41 | BRANCH | worst case misstated | FIXED | 352557087d |
| 4 | 4 | WARNING | tools.win-publish-node-bounded-7951.test.js:155 | BRANCH | external kill skips finally | DEFERRED | pre-existing, documented |

### Final validation (6j)
Full suite on 839f315cea (detached-validate, this Mac): 29,097 node tests passed, 0 failed; 4 shell shards green;
validation-log PASSED hash=64740aae599e. The Ctrl+C case stopped 300 ms after SIGINT under the full-suite load.

### Perturbations (each restored after)
- Ctrl+C held off (one blocking wait in Invoke-ChildBounded): red at 121 s, "Ctrl+C was held off"; no node left.
- Node not killed (the script's finally): red, "the node it started is gone"; the test's cleanup stopped the survivor.

### NITs (non-blocking)
- The 300 ms sleep before SIGINT stays: a fast stop there would be a vacuous pass, never a false red (iteration 4).

### Strengths
- The 600 s limit against a 120 s allowance separates the two cases by 5x whatever the load.
- No assertion passes vacuously; cleanup runs after the assertions and never touches a reused pid.
