---
pre_challenge: true
method: challenge-loop
branch: personalswitch-7404
diff_hash: 1538a8933aaf47ce5a8380ebaf8344519b13b1b26bb9a3fc1c3b4cefbeef37d7
validation: pending
subdir_audit: passed
timestamp: 2026-10-30T22:31:57Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, one blind reviewer at a time (rounds 1 and 2 earlier on 10-30, rounds 3 to 8 this evening).
**Converged:** by the 8-round cap of the review-loop usage rule, with NO open BLOCKER: rounds 6, 7 and 8 found no
blocker. Stated plainly: round 8's three warnings and two nits were fixed (e3be685dca) with mutants shown red, and were
NOT seen by a further reviewer. One round 8 mutant (M3, the early "unknown" return in switchOff) stayed green and is
equivalent: without it the off falls through to orgenroll's refresh, which also fails, and says the same "not known
yet" sentence.

**The design changed in round 5:** the board no longer ends a personal membership its own preview made. kosmos#7658
(Mona Lisa, relay unboundjoin-7658, read by me) ends an unbound one inside a company or family join. Ordering
constraint, on #7404: KOSMOS_PERSONAL_BACKUP must not go on before #7658 (and #7661's relay guards) are deployed.

**Per round** (details in the plan, .claude/plans/personalswitch-7404.md): 3 found the retired-Mac premise and a second-computer move;
4 the reused personal org; 5 that a board-side end can never be atomic (the redesign); 6 lost joins, stale records,
another org since the preview; 7 a restart mid-bind (the in-flight marker), a pin check that could not fail; 8 the
world as well as the Mac, an off that claimed a binding it had not read.

**Validation, stated plainly:** engine/personalbackup-7404.test.js 37/37; orgenroll-5531, orgenroll-print-5532,
agentevents-5683, familysay-6251, workkosmos-6567 green after the orgenroll change; the full-suite-only guards
(engine.reachable, windows-coupling-audit-1732, windows-tests-1777, tools/test-connector-verbs.sh 27/27) green. NOT run
here: the full suite (that is CI's and the Mortals gate's).
