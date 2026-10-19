---
pre_challenge: true
method: challenge-loop
branch: unsentfollow-6256
diff_hash: 09193e7b91adcd9c738e4b596f50e75e1e51a20fffa00673e1abc5d6f8b7d378
validation: on the tree rebased onto main (after #6249 as #6279 and #6271), each run alone from the repo root: chat.unsent-6256 9/9, status.composer-6256 4/4, chat.composer-6249 34, status.unsent-6249 7, web.unsent-input-6249 5, chat.menuhold-5743 23, chat 148, messages 164, roomhold-agyhold-4588 27, roomhold-menu-5743 2, roomhold-stale-4926 12, roomhold-n7diag-4926 5, messages.typingbroke-4926 21, limithold-5805 20, messages.roomhold-4624 14, server.agyhold-4588 25, and the guards engine.reachable, fixture-discipline, comment-deferral, windows-tests-1777, caches.fsync-5434, web.machine-absence-claims, all-node-tests-considered: all pass. CI on the PR is the merge gate.
subdir_audit: passed
timestamp: 2026-10-16T02:34:40Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6: no BLOCKER, WARNING or CONVENTION on the rebased tree; nits only)
**Total actionable findings:** 0 BLOCKERs, 12 WARNINGs, 2 CONVENTIONs (plus NITs)
**Fixed:** all but the stated gaps | **Deferred (decided):** see below | **Asked:** 0

Reviewer models alternated opus and sonnet. Each fix was mutated out and its test went red (plan: Evidence).

#### Iteration 1
**Reviewer model:** opus
- [WARNING] a noted member was told every held project --> FIXED (notes per post and project)
- [WARNING] no limit or sign-out gate (churn) --> FIXED (accountHeldVerdict)
- [WARNING] the sentence promised a send a long line never gets --> FIXED ("tries", "if the box shows only that line")
- [WARNING] hold site and the real box read untested --> FIXED (sendPost test, inputBoxEmpty cases)
- [CONVENTION] flushReleased docblock and server log suffix --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] dim carried from row 0 could empty typed text --> FIXED (the carry restarts at the box row)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] late-emptied earlier line gets no follow-up row --> DEFERRED (stated: an empty box cannot tell sent from cleared)
- [WARNING] a race when the box empties then refills --> DEFERRED (stated, bounded)
- [CONVENTION] plan counts and item 6 --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] pending notes pruned only on the next note --> DEFERRED (duplicate; bounded by 15 minutes of unsent messages)
- [WARNING] same-room plain posts told with the input-held one --> DEFERRED (any wake's shape)

#### Iteration 5
**Reviewer model:** opus
- No BLOCKER, WARNING or CONVENTION: converged before the rebase. NITs taken (paneTarget; bounded re-remember).

#### Iteration 6
**Reviewer model:** sonnet (on the tree rebased onto main)
- No BLOCKER, WARNING or CONVENTION: CONVERGED. Confirmed every flushOnIdle caller passes afterOf and the exports are main's plus noteInput. The rebase itself had re-added an export whose function was gone (ReferenceError on load); the tests caught it before this review and it is fixed (plan: Rebased onto main).

### Deferred, with reasons (stated in the code and the plan)
- An earlier line whose Enter took but whose box emptied after the 300 ms watch gets no follow-up row.
- When the box reads empty and the delivery is then refused (a person typing in that instant), the minute sweep logs a line each minute while it lasts.
- Same-room plain posts are told with an input-held one (that is any wake's shape).
- Closed with reasons on #6256: items 5, 8, 9, 10, 11.
