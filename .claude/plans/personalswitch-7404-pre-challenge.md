---
pre_challenge: true
method: challenge-loop
branch: personalswitch-7404
diff_hash: bfcc4c465b99ab08b3ac55130c929ece743e171b0419a135d617060c1373140b
validation: pending
subdir_audit: passed
timestamp: 2026-10-30T22:35:32Z
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

**Re-hash after rebasing onto kosmos main c06da40d1a:** clean rebase; the tests and guards listed above rerun green on the new base (connector-verbs 27/27).

## Iteration 1 (code review 1, earlier 10-30)
- [BLOCKER] policy calls did not follow the personal root (a personal enroll could clear a company policy): INERT_POLICY on every orgenroll call; fixed, with a control that the same leave without it wipes the policy.
- [WARNING] follow-up cadence and ticket handling (see the plan); fixed.

## Iteration 2 (code review 2)
- [BLOCKER] the preview makes a membership nothing ended. Decided again in iteration 5 (the relay ends it at a join, #7658).
- [BLOCKER] personal refusal codes read as "unknown": orgenroll's SAY learns them; fixed.
- [WARNING] a pending leave was followed up every two minutes forever; the key-ready marker went stale; generic sentences; the idle guard untested; fast follow-up untested. All fixed, mutants red.

## Iteration 3
- [BLOCKER] a second computer's switch-on MOVED the first's binding: status read before the preview and the enroll, personal_on_elsewhere; fixed.
- [WARNING] a retired Mac reads as unbound (found by me in the relay's ORG_MEMBERSHIP_SELECT); an in-flight enroll raced the follow-up; the key marker erased before the enroll; fixed.

## Iteration 4
- [BLOCKER] the personal org is reused across computers, so {orgId} could not tell this preview's membership from another computer's bind: superseded by iteration 5's decision.
- [WARNING] the follow-up raced this computer's own switch-on; a re-preview did not refresh the marker; fixed then removed with the ending code.

## Iteration 5
- [BLOCKER] (relay) key rows never deleted: Mona Lisa fixed it in unboundjoin-7658 (rows of the current membership only).
- [BLOCKER] status-then-leave is never atomic on a relay that ignores the guard fields: DECISION, the board ends nothing; #7658 ends an unbound membership at the join.
- [WARNING] no status answer still made a membership; an unconfirmed recovery code read "on": fixed.

## Iteration 6
- No BLOCKER found.
- [WARNING] two computers enrolling at once (relay: filed #7661); a lost join stranded by an off; an account in another org since the preview; the key step did not check the binding: board parts fixed, mutants red.

## Iteration 7
- No BLOCKER found.
- [WARNING] a restart mid-bind read "off" (in-flight marker added); a pin check named a file that never exists (fixed with a control).

## Iteration 8
- No BLOCKER found.
- [WARNING] an off claimed a binding it had not read; thisComputer is the Mac, not the Kosmos (world now compared); no test that the marker is written. Fixed, mutants red except one equivalent (stated above).

## Final ledger
BLOCKERs open: 0. Relay follow-ups owned elsewhere: #7658 (Mona Lisa), #7661 items 1 (Baron), 2 (Mona Lisa), 3 (Kitty).
