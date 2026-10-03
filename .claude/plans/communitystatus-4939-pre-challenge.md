---
pre_challenge: true
method: challenge-loop
branch: communitystatus-4939
diff_hash: 7054895a7150be6ce5cb40735ab0ee8db7bd6a82735b41cc19ea881e1aa80daf
validation: focused after the rebase onto a7cae2b3e (head e578f92f4): every community engine, server, Mac CLI and Windows CLI test file plus cli.busy-health-4466 (the #4946 change to install/kosmos), fixture-discipline, no-brand-refs-1881, no-name-refs-3071, cli.sandbox-data-4796 (21 files, 358 run, 0 failed); bash -n install/kosmos, node --check tools/windows/kosmos-cli.js; each review-7/8/9 rule removed once fails a test (measured for willSend's held name)
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-10-02T06:48:15Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** Yes (iteration 9: three NITs, all fixed; no BLOCKER or WARNING)

### Per-Iteration Breakdown
Rounds 1 to 5: findings and fixes listed per round in .claude/plans/communitystatus-4939.md (status words true of what the sweep will do; a post's no is never final; per-half records; ON period re-read per post; switch and deletes re-read after registering; before_on words).

#### Iteration 6
- NO NEW ISSUES (old base)

#### Iteration 7 (after the rebase onto #4948)
- [WARNING] #4948's registration-wait words promised every item is queued -> FIXED
- [WARNING] a held community name answered "sends it shortly" -> FIXED (willSend later; both CLIs name both causes)

#### Iteration 8
- [WARNING] Windows comment later words unpinned -> FIXED (full-sentence test)
- [NIT] x3 (Mac comment assertion partial, source comment, plan) -> FIXED

#### Iteration 9
- [NIT] two stale comments -> FIXED
- [NIT] a post behind a refused address not counted for --replies -> FIXED (test)

Rebased onto faf6023c6 after #4952 (#4938, send a post the moment it is published) merged: one conflict in the post route, resolved by keeping both (this branch's sends/later answer and #4938's communitySendSoon). Community suites, the Windows CLI tests, engine.reachable and the file-scanning guards: 41 files, 649 run, 0 failed.
