---
pre_challenge: true
method: challenge-loop
branch: stubsweep-8890
diff_hash: d6098b76c632b3f34d6971ff82b375e61c83befc0c6a8f1faef4a4d673821106
validation: local: tools.run-tests-stubsweep-8890.test.js 3 of 3; with tools.run-tests-file-timeout-6668, -only-4929, -chunks-7257, fixture-discipline and engine.reachable 69 of 69 (queued turn, review-3 head; review 4 changed only test names, comments and the plan), tools/test-test-leak-guard-4273.sh PASS. Every rule shown red with it removed (6 mutations). The full suite runs on the PR's CI.
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-22T11:28:48Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (fresh blind reviewers, each seeing none of the earlier rounds)
**Converged:** Yes. Round 4 found no BLOCKER; its two WARNINGs were the run arms' wording claiming more than they prove, fixed without touching the code.
**Total actionable findings:** 0 BLOCKERs, 11 WARNINGs, 12 NITs
**Fixed:** every WARNING, most NITs | **Accepted:** listed below | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] it stopped any process naming the root, an operator's tail -f included --> FIXED (only orphans or the runner's descendants)
- [WARNING] no control for that --> FIXED (an observer control)
- NITs: one shared matcher, no leaked helper, the INT arm's scope said --> FIXED

#### Iteration 2
- [WARNING] the controls were not orphans, so the prefix mutation could not fail --> FIXED (a direct arm with real orphans)
- [WARNING] the descendant walk untested --> FIXED (direct arm)
- [WARNING] a closed pipe could end the trap --> FIXED (trap ignores PIPE)
- [WARNING] the grace re-read every process --> FIXED (per pid)
- [WARNING] a reused pid could be signalled --> FIXED (re-read before TERM and KILL)
- Also found while fixing: a killed child reads alive as a zombie --> FIXED (liveness from ps state); a shell-loop descendant walk took 83 s --> FIXED (one awk pass)

#### Iteration 3
- [WARNING] the re-read passed a pid on its old membership --> FIXED (by its parent now)
- [WARNING] a failing direct arm could leave stubs --> FIXED (cleanup from each pid file)
- NITs: the KILL path untested --> FIXED (a TERM-ignoring stub); a second INT or TERM cut the trap short --> FIXED; plan wording on a reused runner pid --> FIXED

#### Iteration 4
- [WARNING] the run arms' controls are protected by ownership, not the matcher --> FIXED (the claim moved to the direct arm)
- [WARNING] the Ctrl-C arm cannot fail without this card's change --> FIXED (named as a guard on #4273)
- NIT: a root followed by ";" or a quote is not matched --> ACCEPTED (the plan's weakest premise; the six found on 11-22 all matched)

### Accepted, and why
- A process that names the root only in its environment, or by a path outside the root, is not matched: ps cannot read the environment on macOS.
- An orphan of an earlier, dead run that had this run's pid is swept too: it is that run's leak either way.
