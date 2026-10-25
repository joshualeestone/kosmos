---
pre_challenge: true
method: challenge-loop
branch: newtask-7078
diff_hash: dd3121b65ad611b20ff1b5e2b0309f08e6d714080a504ab505500af122a0e834
validation: passed (Mortals, 23864 tests, 0 fail, entry status clean, hash dd3121b65ad6 = this diff_hash)
subdir_audit: passed
timestamp: 2026-10-25T06:06:06Z
iterations: 22
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 22 (iteration 1 = the blind review recorded in the plan, opus, before this run; 2 to 22 in this run)
**Converged:** Yes, twice. Iteration 18 (sonnet) found no BLOCKER/WARNING/CONVENTION at 6235471c4b; a change made from
the final design shots (08e7a9c05c, the Create it anyway tint) reopened the loop; iteration 22 (sonnet) found none at
e0f16f6f82.
**Total findings in this run:** 47 ledger rows (2 BLOCKERs, 41 WARNINGs, 3 CONVENTIONs, 1 own-shot WARNING), plus NITs
**Fixed:** 40 | **Deferred:** 6 | **Asked (awaiting user):** 0

**Validation:** the final head e0f16f6f82 passed the full suite on Mortals (23864 tests, 0 failures, entry "clean",
not a reused skip). Release and Debug also typecheck against the iOS simulator SDK, with a control that fails on the
iteration-8 Release BLOCKER put back. Local Xcode Debug and Release builds of the final head succeeded (XCB_RC=0).

**Deviations, stated:** 6.0's first validation ran concurrently with iteration 2's read-only review rather than before
it. The Origin column below was recorded from the fix history while working, not by the mechanical blame lookup of
6c-bis, so treat SELF/BRANCH as judgement. The branch was rebased twice (onto #7074, then #7084), so the commit refs
before 22:30 and before 23:50 CDT name pre-rebase commits (backups: ick-backup-newtask-7078-prerebase,
ick-backup-newtask-7078-prerebase2).

### Per-iteration breakdown

Reviewer models alternated: 1 opus, 2 sonnet, 3 opus, 4 sonnet, ... 21 opus, 22 sonnet.

- Iteration 2 (sonnet) + 6.0: BLOCKER initial-validation (routes sweep could not read the request); 2 WARNING (stale kept project, status 0 as refusal); 1 CONVENTION (review-history comments). All FIXED.
- Iteration 3 (opus): 3 WARNING (relay 502/504 as refusal, failed read clears Part of, announcement lost on dismiss). FIXED.
- Iteration 4 (sonnet): 2 WARNING (Create before projects read, answer below the fold). FIXED.
- Iteration 5 (opus): 2 WARNING (nothing sent read as could-not-tell, no 200/2000 limits). FIXED.
- Iteration 6 (sonnet): 2 WARNING. Double tap FIXED; CI path filter DEFERRED (filed #7084, since closed by #7084).
- Iteration 7 (opus): 5 WARNING + 1 CONVENTION, incl. the conflict with #7074 (rebased, both sides kept). FIXED.
- Iteration 8 (sonnet): BLOCKER Release did not compile (Debug-only sample symbol). FIXED, Release compile added locally. 1 FIXED, 1 DEFERRED.
- Iterations 9 to 17: WARNINGs almost all inside the loop's own could-not-tell hold (self-generated). Iteration 11 simplified the hold instead of patching it again. 2 DEFERRED (iteration 16).
- Iteration 18 (sonnet): 0 actionable. CONVERGED.
- Iteration 19 (opus, after the tint change): 1 WARNING (tab-found path not announced). FIXED.
- Iteration 20 (sonnet): 4 WARNING, 2 FIXED (+ without the Tasks read, Cancel during the check), 2 DEFERRED.
- Iteration 21 (opus): 1 WARNING (late found from a cancelled sheet) FIXED by one handler in the Tasks tab; 1 CONVENTION (plan vs #7084) FIXED after the second rebase; #7084's parity test then runs this suite (7/7).
- Iteration 22 (sonnet): 0 actionable. CONVERGED.

### Deferred (6), each with its reasoning in .claude/plans/newtask-7078.md
- [WARNING] .github/workflows/ios.yml path filter: shared with three sibling suites; now covered on main by #7084's parity test.
- [WARNING] a parent task closed between pick and Create is dropped silently: the board's select does the same.
- [WARNING] Return in a question becomes a space: single-line fields would undo the largest-text wrap fix.
- [WARNING] create()'s early return resets the latch by hand: fragile, no live bug.
- [WARNING] reopening from a picked project discards a draft for another project silently: the board's ntAimAt does the same.
- [WARNING] the Part of picker draws the last read that came back while the prune keeps the pick; the hold has no expiry: deliberate, the Mac refuses a stale parent, and a false "Added task" needs an agent's same-words task in the window.

### Outstanding questions
None.

### NITs left (selection)
sampleNewTaskShown outside #if DEBUG; members shown without their role; 0.7 s announcement delay is a guess; two Tasks
refreshes can overlap; the view state has no automated test (no UI test target); Result.made(note:) read only by tests.

### Strengths (recurring across reviewers)
- The request matches the board's nt-go key for key, pinned against web/index.html with a control; isProjectId gates the path; the person's-screen header comes from BoardClient's one wrapper, pinned with a control.
- "Nothing sent", "no answer" and "refused" are told apart; the board's words and limits are read from web/index.html and engine/tasks.js rather than restated.
- Create latches in its tap; the epoch is checked after every await; Debug-only samples are fenced with Release stubs.
