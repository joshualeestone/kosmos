---
pre_challenge: true
method: challenge-loop
branch: orgmemberflake-6643
diff_hash: 08e8d8fbb1180e9ab87170349cad2b88cbd2e76ec4d45e9502512e0b4d4c9288
validation: passed (focused, test-only change: server.orgmember-6560.test.js 9/9 three runs, also 9/9 with the rig's stub coordinator delayed 5 ms; server.orgenroll-5531.test.js 40/40)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-20T03:59:50Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 raised one NIT, fixed)
**Total findings:** 1 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 1 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Self-generated:** 0
- [NIT] fixed: the review-1 comment overstated the old weakness. The +20 min call would still have caught a missing latch, so the arm was weakened, not passing for the wrong reason.
- Confirmed by the reviewer: the cause is that orgEnrollRefresh overwrites ORG_MEMBER_CHECKED_AT with the real Date.now(), so a follow-up at the pre-call `at` + 10 min + 1 ms is "not due" once the ask takes over 1 ms. That gives the CI failure exactly.
- Ruled out by the reviewer: the BUSY flag (cleared in finally before the awaited promise settles), the promise chain (fully returned), shared module state (rig resets both ways), and timers (unref'd; live execution off at start).
- Checked by the reviewer: no other arm in server.orgmember-6560.test.js or server.orgenroll-5531.test.js has a 1 ms boundary. Every due-expecting call there has a margin of a minute or more.

### Measurements (author)
- Reproduced: with the rig's stub coordinator delayed 5 ms, the review-2 arm fails every time (1 !== 2) and the other 8 arms pass.
- After the fix, with the same 5 ms delay: 9 of 9 pass.
- Product control 1, delay on: the "full ask disagreed" latch removed from orgMemberCheckIfDue turns the review-1 arm red.
- Product control 2, delay on: the latch set on any full-ask answer, including unclear ones, turns the review-2 arm red.

### Deferred
None.
