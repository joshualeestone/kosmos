---
pre_challenge: true
method: challenge-loop
branch: startedby-5450
diff_hash: 5d1e0359745435c635ef540d97732abc74b538f72f87d96ee6dce4bffa95d886
validation: passed (Mortals full suite at 0cd505494, hash 7f6c84fab829); no web/ change, so no browser check applies
subdir_audit: passed
timestamp: 2026-10-08T01:12:31Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (blind reviewers alternated between Opus and Sonnet; each reviewed only this branch's own change)
**Converged:** Yes (iteration 10, Sonnet: one NIT, review labels in comments, which match the repo's style; left)
**Total findings:** 2 BLOCKERs, 18 WARNINGs, NITs
**Fixed:** 18 | **Deferred:** 2 (the Mac app reopened at login, and the Windows half, both on #5450) | **Asked (awaiting user):** 0

Local evidence at f7926e3fe: cli.startedby-5450, engine/restartnote-5359, server.restartnote-5359, the neighbouring
CLI, install and watchdog tests and the repo guards (fixture-discipline included), 135/135; tools/test-board-watchdog
0 failures. Every guard added in the loop has a mutation that turns it red (listed per review in the plan).

### Per-Iteration Breakdown

- [BLOCKER] Iteration 1: an unreadable or octal-looking mark stopped board-run under set -e (launchd crash loop);
  the watchdog's `kosmos start` read as a person's, losing the note in the case it exists for. FIXED, both pinned.
- [WARNING] Iteration 1: a person's mark deleted before the board used it; the variable could reach children. FIXED.
- [WARNING] Iteration 2: KOSMOS_START_BY could reach the board and its panes. FIXED (stripped twice, deleted at load).
- [WARNING] Iteration 3: a person's start raced launchd's relaunch (mark written after the stop marker went);
  the server wiring was unguarded. FIXED (mark first; wiring pinned).
- [WARNING] Iteration 4: board-run deleting a stale mark could delete a fresh one; start and stop were tested by
  source only. FIXED (board-run deletes nothing; atomic write; behavioural tests).
- [WARNING] Iteration 5: an unjudgeable mark read as the supervisor's; the direct start's default unpinned. FIXED
  (unknown; pinned).
- [WARNING] Iteration 6: the string 'unknown' untested in noteFor; the 120 s bound unpinned. FIXED.
- [WARNING] Iteration 7: the mark removal for non-person starts unpinned; stale plan text; the Mac app reopened at
  login (safe direction) DEFERRED to #5450 (needs the app).
- [WARNING] Iteration 8: a forward clock jump inside the window: DECIDED limit, reasoned in the plan.
- [WARNING] Iteration 9: the mark removed before the beat (a kill between them could make a false note). FIXED,
  pinned. The boot-relative redesign REJECTED with reasons.
- [NIT] Iteration 10: review labels in comments. Left (the repo's style).

### After convergence (disclosed)

- 8a734cf39 merged restartnote-5359 into this branch (a 12-commit rebase re-conflicted on every commit, so one merge
  instead). Unions: install/kosmos keeps both the person-mark block and #4636's stop-marker block, and the launch line
  keeps KOSMOS_START_BY and KOSMOS_BOARD_STARTED_BY plus `local _launched`. server.js keeps one restart-note call,
  below the file-preview sweep, with this branch's arguments.
- f7830539a merged main after #5359 part 1 landed as a squash. engine/restartnote.js, engine/restartnote-5359.test.js
  and server.restartnote-5359.test.js take this branch's side, because main changed them only by that squash.
  server.js keeps this branch's restart-note call. After the merge the diff against main is this branch's 8 files
  only, and its 98 pinning tests and the copy guard pass.
- 0cd505494 moves this branch's four started-by lines in server.js from between the world bootstrap and the log stamp
  to just after the stamp block. The first full suite at f7830539a failed only on the #4199 pin
  (engine/logstamp.test.js), which requires the stamp to come right after the bootstrap. The stamp starts no process,
  so the values are still taken out of the environment before anything could inherit them. The stamp pin, the
  world-order guard and this branch's tests pass (38). This fix was not re-reviewed.

## Re-hash after merging main (2026-10-08 00:20 CDT)
CI's shell shard 1/2 failed twice on the suite's leak check (tunnelgate-test.srl, a file this change does not touch;
all 115 tests passed both times). Main had moved, so origin/main was merged in, with no conflict. The change is
unchanged: the added and removed lines against the base (8 files, 446/12) hash the same before and after
(249678f172ebd5fd); only line numbers and context moved, which is what changed the diff hash above.
