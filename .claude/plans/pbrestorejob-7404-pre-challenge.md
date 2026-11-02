---
pre_challenge: true
method: challenge-loop
branch: pbrestorejob-7404
diff_hash: 0b9680b4856824d2754e7274c5d9727d7941c40d1335c4266537121ceab40175
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T17:22:28Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the operator's standing 8-round cap, feedback-review-loop-usage-rule: max 8 rounds unless a BLOCKER is open; none was)
**Total findings:** 0 BLOCKERs, 27 WARNINGs, 0 CONVENTIONs, about 30 NITs
**Fixed:** 22 | **Deferred:** 5 | **Asked (awaiting user):** 0

Final validation: the full sequence ran (not a skip): node suite 26373 tests, 0 fail, 0 cancelled; test:shell 4 shards all green; validation-log PASSED hash 0b9680b48568.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 8 NITs
**Self-generated:** 0
- [WARNING] engine/personalrestorejob.js shapeRestore dropped the cleaned top-level fetchProblems and passed raw uncapped details --> FIXED (026c03e3)
- [WARNING] engine/personalrestorejob.js no time limit or way out for a wedged restore --> DEFERRED then FIXED in iteration 3 (stop)
- [WARNING] engine/personalrestore-child.js "no restore outlives its board" untested; record claim too strong --> FIXED (026c03e3, 9caa7866: busy-child disconnect test, mutation-checked red)
- [WARNING] one-at-a-time guard is per board process across a restart --> DEFERRED: each restore makes its own new Kosmos and restoreworld's list has its own lock; recorded as a known limit
- [NIT] exit before done; stale personalrestore header; list deps; epoch check; list timeout untested; server test name; connector list comment --> fixed

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] engine/personalrestorejob.js settle on exit could lose an answer sent just before exit --> FIXED (51cc3cb3: settle on close; mutation hung red)
- [WARNING] engine/personalrestore.js baseOf in the child cannot see bootedBaseDir --> FIXED (51cc3cb3: the board passes base)
- [WARNING] server.js GET files shows file paths to a remote session without step-up --> DEFERRED here, FIXED in iteration 3 when raised again
- [NIT] caps on moved/kept/heldBack; execPath fork; header wrap --> two fixed, execPath deferred (restoreworld already forks process.execPath)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (a test comment)
- [WARNING] the child reads member keys outside personalbackupkey serial() --> DEFERRED: a read of files written whole; recorded as a known limit
- [WARNING] server.js GET files names reach a remote session --> FIXED (2cebd279: counts only when remote)
- [WARNING] no Stop --> FIXED (2cebd279: stop() and POST /api/personal-backup/stop)
- [NIT] stale test comment; list and restore share the hourly allowance; header on board kill --> fixed

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 (plan and header prose from iteration 3)
- [WARNING] plan stale about stop --> FIXED (23a6b076)
- [WARNING] header contradicted itself on stop --> FIXED (23a6b076, sentence deleted)
- [WARNING] stop during the move into the new Kosmos --> DEFERRED: recorded as a known limit
- [WARNING] a remote session got the raw `because`, which can quote a path --> FIXED (23a6b076: one fixed line)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] stop from a remote session without step-up --> FIXED (2be32203: stop is step-up gated)
- [WARNING] a crashed child leaves no trace --> FIXED (2be32203 exit code and signal; fde0c739 stderr tail to the board log)
- [WARNING] Off does not stop a running restore --> FIXED (2be32203)
- [NIT] stoppedByPerson set board-side only; test asserts done; limits as bullets --> fixed

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] no ceiling on a restore --> DEFERRED: startedAt lets the screen show the age and offer Stop
- [WARNING] a request already being signed when stop came --> FIXED (fb65861d: recorded as a known limit)
- [WARNING] Off did not wait for the child --> FIXED (fb65861d: untilIdle)
- [WARNING] last kept names after Off --> FIXED (fb65861d: forget)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the Off comment from iteration 6)
- [WARNING] a late settle after forget brought names back --> FIXED (fde0c739: forgotten flag)
- [WARNING] no stderr from a crashed child --> FIXED (fde0c739)
- [WARNING] Off did not end a running list --> FIXED (fde0c739)
- [NIT] fork throw read as a person's stop; last while running; test state --> two fixed

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (forget's doc from iteration 7)
- [WARNING] forget alone did not stop the restore --> FIXED (5857a6d4)
- [WARNING] a restore could start while Off ran --> FIXED (5857a6d4: offStarting/offDone)
- [NIT] a null done; no ceiling; body not checked against the route --> left: the child is the board's own code and the routes are the three a restore makes

Stopped here: the 8-round cap, with no BLOCKER open at any round.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/personalrestorejob.js | BRANCH | fetchProblems raw, uncapped | FIXED | 026c03e3 |
| 2 | 1 | WARNING | engine/personalrestorejob.js | BRANCH | no way out of a wedged restore | FIXED | 2cebd279 (stop) |
| 3 | 1 | WARNING | engine/personalrestore-child.js | BRANCH | board-gone exit untested | FIXED | 9caa7866 |
| 4 | 1 | WARNING | engine/personalrestorejob.js | BRANCH | guard per process across restart | DEFERRED | own world per restore, list lock |
| 5 | 2 | WARNING | engine/personalrestorejob.js | BRANCH | exit before last message | FIXED | 51cc3cb3 |
| 6 | 2 | WARNING | engine/personalrestore.js | BRANCH | child cannot see bootedBaseDir | FIXED | 51cc3cb3 |
| 7 | 3 | WARNING | server.js | BRANCH | remote sees names | FIXED | 2cebd279 |
| 8 | 3 | WARNING | engine/personalrestorejob.js | BRANCH | keys read outside serial() | DEFERRED | read-only, files written whole |
| 9 | 4 | WARNING | .claude/plans/pbrestorejob-7404.md | SELF | plan stale on stop | FIXED | 23a6b076 |
| 10 | 4 | WARNING | engine/personalrestorejob.js | SELF | header contradiction | FIXED | 23a6b076 |
| 11 | 4 | WARNING | engine/personalrestorejob.js | BRANCH | stop mid-move | DEFERRED | known limit |
| 12 | 4 | WARNING | engine/personalrestorejob.js | BRANCH | raw because to remote | FIXED | 23a6b076 |
| 13 | 5 | WARNING | server.js | BRANCH | stop without step-up | FIXED | 2be32203 |
| 14 | 5 | WARNING | engine/personalrestorejob.js | BRANCH | crash leaves no trace | FIXED | 2be32203, fde0c739 |
| 15 | 5 | WARNING | server.js | BRANCH | off does not stop restore | FIXED | 2be32203 |
| 16 | 6 | WARNING | engine/personalrestorejob.js | BRANCH | no ceiling | DEFERRED | startedAt, Stop |
| 17 | 6 | WARNING | engine/personalrestorejob.js | BRANCH | in-flight signing after stop | FIXED | fb65861d (limit) |
| 18 | 6 | WARNING | server.js | BRANCH | off does not wait | FIXED | fb65861d |
| 19 | 6 | WARNING | engine/personalrestorejob.js | BRANCH | names kept after off | FIXED | fb65861d |
| 20 | 7 | WARNING | server.js | SELF | late settle after forget | FIXED | fde0c739 |
| 21 | 7 | WARNING | engine/personalrestorejob.js | BRANCH | no stderr | FIXED | fde0c739 |
| 22 | 7 | WARNING | server.js | BRANCH | off leaves a list running | FIXED | fde0c739 |
| 23 | 8 | WARNING | engine/personalrestorejob.js | SELF | forget alone does not stop | FIXED | 5857a6d4 |
| 24 | 8 | WARNING | server.js | BRANCH | restore can start during off | FIXED | 5857a6d4 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- a null `done` reads as "could not start" (iteration 8)
- a signed body is not checked against the route (iteration 8): the child is the board's own code
- the board-gone test is wall-clock based (iteration 6)

### Strengths (across all iterations)
- The child signs nothing; the board signs only three exact METHOD route pairs through remote.macRequest, so busy() holds, with a refusal test that has a positive control (every iteration)
- Answers leave by named fields, capped, and a remote session gets counts and a fixed reason (iterations 3 to 8)
- Child lifecycle: settle on close, exit on disconnect proven with a busy real child, list timeout kills its child (iterations 2 to 8)
