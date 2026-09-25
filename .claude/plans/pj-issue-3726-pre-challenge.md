---
pre_challenge: true
method: challenge-loop
branch: pj-issue-3726
diff_hash: 196c5198bad4595f1b453700be8e5311fe12da4808e8e9806e31c1780b2fd8b4
subdir_audit: passed
timestamp: 2026-09-25T18:15:02Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind reviewers: opus, sonnet)
**Converged:** Yes. Pass 2 found 0 blockers and 0 warnings (1 nit, not taken).

## Iteration 1 (opus): 1 blocker, 1 warning
- [BLOCKER] The new unit test failed in the whole-file run (an earlier test leaves a self-report on claudebot) -> fresh names; 141/141.
- [WARNING] pjMember always replaced the member's reconnect with LAST's, so the pill and the row could disagree -> the row reads m.reconnect first, LAST only as fallback; unit arm, red with the old line.
- [NIT] A comment claimed a trust wait counts today -> corrected. Control used a non-phase -> real phases. Tied gate on reconnect unguarded -> asserted.
- [NIT] Pre-existing: the pill counts a class-2 agent question pjMember draws calm (#2808's deferred split). Not this card.

## Suite round (recorded because it changed code)
- fixture-discipline.test.js refused hand-built card rows in my web test -> built from the real fleet card.

## Iteration 2 (sonnet, confirming): 0 blockers, 0 warnings
- Verified the two polls share a 5s period; state and reconnect on a member come from the same answer; no path shows a fresher LAST against a staler member row. Four perturbations each red.
- [NIT] A duplicate 'retried' assertion after the new loop. Harmless; not taken.

## Measured
- Full suite PASSED on 516adc010 (9438 tests, 0 failed).
- engine/projects.test.js 141, server.connlost-reconnect-3410.test.js 2, web.connection-lost-3410.test.js 16; every new arm red without its half.

## Weakest premise
- A trust wait never reaches the project roster today (those rows are built offline), so such a member is not counted; the rule covers it when it does.
