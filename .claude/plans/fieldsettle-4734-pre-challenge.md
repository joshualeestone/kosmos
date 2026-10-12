---
pre_challenge: true
method: challenge-loop
branch: fieldsettle-4734
diff_hash: 63a3e4f35d764a11227fc8ed84be74a27aaa780948b86486c4f21a6942ce7871
validation: REBASED 2026-10-04 19:15 CDT onto main after #5106 merged (this branch had been stacked on an older #5106 head; git dropped those commits as applied, this branch's own commits replayed clean); browser-checks-reason-grep + tools.browser-checks-wired 18/18 on the rebased tree. A fresh Mortals run on this head is queued. Earlier: full tools/run-tests.sh on Agent1s at 844103b7d (2026-10-02 21:34 CDT): 14469 tests, 14245 pass, 1 fail, the shared reason-grep emit-site count; fixed (rebased onto main, 233 -> 236 as measured) and that file passes 5/5; both browser-check gates rc 0. The PR's CI runs every suite on the merged tree before the watcher merges.
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-10-05T16:12:17Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind rounds (Opus, Sonnet), recorded in .claude/plans/fieldsettle-4734.md.
**Converged:** Yes, at iteration 2 (0 BLOCKER, 0 SHOULD-FIX).
**Total findings:** 0 BLOCKERs, 3 SHOULD-FIXes (round 1), all taken.
**Fixed:** every SHOULD-FIX | **Asked (awaiting user):** 0

**Deviations, stated:**
- The full run caught one failure the reviews did not: the branch added three counted emit sites and never bumped the shared counter. Fixed and measured; recorded in the plan as my miss.
- The validation board was the plain sandboxed board, not the cut's rich board; counts and timings are that board's (round 1 NIT2).

### Per-Iteration Breakdown

#### Iteration 1 (Opus): 0 BLOCKER, 3 SHOULD-FIX
- FIXED: the counts window could close before the board's first /api/status poll answered; settle now awaits that response.
- FIXED: "card defined" was no readiness signal; replaced by the answered poll.
- FIXED: the floor comment's dead-script claim was false; the floors catch the wrong page, the answered-poll wait catches the dead script.
- Measured: main OK; new OK (control 0 vs 3 late fields); floor 1000 -> FAIL; SETTLE_MS 0 -> the control fails; a wrong poll path -> FAIL rc 1.

#### Iteration 2 (Sonnet): CONVERGED
- tick() always runs, so a script that dies before the first poll now fails on the answered-poll wait; the predicate matches only /api/status.
- NITs taken: comment wording on the two 20 s limits; "probably" for the cause of the late controls.


### Rebase 2026-10-05 11:15 CDT
Rebased onto main again: one conflict in browser-checks-reason-grep.test.js SITE_COUNTS (main added render-federation-invite-4649.js beside this branch's render-fields.js 2 -> 5); kept both. browser-checks-reason-grep.test.js 7/7 locally. A fresh Mortals run and the render-fields check run on this head before merge (the earlier Mortals 15148/0 was on 561b807d9).
