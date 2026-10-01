---
pre_challenge: true
method: challenge-loop
branch: agent-projects-4491
diff_hash: e133eba5f553c7318f2d65ddb695982b9393b2fb9867607972e2398f160651ea
validation: passed (Mortals, stack top report-token-only-4491 at be5555c23, hash 798376dfea0e, #4749 E: the top of a stack validates it); rebased since onto main, with a conflict in engine/assigner.js resolved by keeping main's paused-project lines (#4771) beside this branch's goal-ask skip (this branch's assigner change is byte-identical on the new base); focused tests at this head 131/131 (assigner, agent-projects, CLI token verbs, Windows CLI, the #4796 guard); CI runs the full suite on the merge ref
subdir_audit: passed
timestamp: 2026-10-01T04:32:44Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind reviews (opus on the odd rounds, sonnet on the even), each of this branch's own change, told only the decisions recorded in the plan.
**Converged:** Yes. Round 6, a sentence-by-sentence truth pass, returned no BLOCKER, WARNING or CONVENTION.
**What review changed**, all recorded in `.claude/plans/agent-projects-4491.md`: putting the maker on its project brings every behaviour a member has, and the rounds found them one by one.
- The maker is not typed at, and is not told to ask for a brief, for a project it just made; the setup guide is never put on a project (round 1).
- The clock's Assigner does not ask a maker alone on its own project to draft tasks toward its own goal; tasks already there are handed out (rounds 3 and 5; round 3's wider skip was narrowed).
- The headline promise, that the maker can post in its project's room, has a test (round 5).
- This moved to its own card, #4740, in round 3: it changes what an agent-made project is, not which token opens a route.
Every rule has a mutation that turns a test red (the plan lists them).

## Iteration 1 (opus): 0 BLOCKER, 4 WARNING, 1 CONVENTION, 3 NIT
- [WARNING] The "no brief yet" room note fired for a maker alone on its own project. It needs a member other than the maker.
- [WARNING] Every create typed a line into the maker's pane, outside the member valve. The maker is not typed at; its instructions are still synced.
- [WARNING] The setup guide was not considered. It is recorded as the maker and never put on the project.
- [WARNING] "Named members are kept and the maker added" was not pinned. It is.
- [CONVENTION] The plan omitted the brief note, the tied-pane tightening, and the person typing in an agent's pane. Stated.

## Iteration 2 (sonnet): 0 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NIT
- [WARNING] A maker with no roster row: the comment said its instructions "are still synced", which is not always so. Measured on the real route; the comment and plan say what happens, and a test pins it.
- [CONVENTION] The exception's comment left out the setup guide as a source of memberless projects. Added.

## Iteration 3 (opus), a pass around the change: 0 BLOCKER, 2 WARNING, 1 CONVENTION, 3 NIT
- [WARNING] The Assigner would drive an agent-made project with no person involved. It skipped a maker alone on its own project (narrowed in round 5).
- [WARNING] The maker's card can say "told it on its screen" though Kosmos typed nothing. Declared.
- [CONVENTION] A stale plan sentence. Reworded.

## Iteration 4 (sonnet): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 2 NIT
- [WARNING] The Recommender (off by default) now acts for a maker stuck on its own project. Stated, left as it is.
- [WARNING] The retell sweep can type one line into the maker's pane later, if its sync failed at create. Stated.

## Iteration 5 (opus), a final pass: 0 BLOCKER, 2 WARNING, 1 CONVENTION, 3 NIT
- [WARNING] "You post to it" had no test. Added through POST /api/post, with another agent as the control.
- [WARNING] The Assigner skip made the page's description untrue for a project that shows a member. Narrowed to the goal ask; the one remaining mismatch with the page text is stated.
- [CONVENTION] A sentence contradicted the plan's own Why. Reworded.

## Iteration 6 (sonnet), a truth pass: 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT. CONVERGED
- Two wording NITs, taken. No code changed after this round's review.

## Validation
- Full suite: validation passed (Mortals), recorded for this exact diff hash.
- server.agent-projects-4491.test.js 10 of 10; engine/assigner.test.js with its new case. The related test files (project creation, the gate, both CLIs, the guide, the Assigner): __FINAL__, on the rebased tree.
- `bash -n install/kosmos` and `node --check` on the touched scripts pass. Both browser-check gates pass (no page change).

## Weakest premise
- That an agent which makes a project should be on it by default. Its working rules say so in as many words; nobody has ruled on a lead agent that sets up projects for others and does not want to be in their rooms.

### After convergence: rebase onto main
main's #4771 added paused-project skips to the same two Assigner loops. Resolved by keeping both; this branch's
assigner diff is unchanged on the new base (compared line for line). Mechanical, not separately reviewed.
