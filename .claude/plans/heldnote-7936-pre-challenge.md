---
pre_challenge: true
method: challenge-loop
branch: heldnote-7936
diff_hash: 3ea1faffb61247bfcbd8a9803e93781b73487a798e140f2855b054c032d60454
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T14:15:03Z
iterations: 9
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** No (stopped after round 9: the cap of 8 plus one round for round 8's fix of a blocker-class defect; no BLOCKER open)
**Total findings:** 46 (0 BLOCKERs, 30 WARNINGs, 0 CONVENTIONs, 16 NITs)
**Fixed:** 33 | **Deferred:** 13 | **Asked (awaiting user):** 0

Validation: the full suite passed on ce98b91038 (07:46 to 08:08). The first run (07:23) was red only on
fixture-discipline.test.js, a hand-built card in this branch's own test; fixed in ce98b91038. Also run directly:
engine/heldnote-7936.test.js 20/20 and 17 related suites (limitmsg-5805, limittask-5805, inputkeep-6774 engine, server,
cli, limitdm-5805, heldwarn-7212, heldwarn2-7212, stallpush-7212, stallended-7212, stallack-7794,
deliverystreak.turn-7368, stallob-7633, inbox-unanswered-7155, the two 4891 CLI gap tests). Mutation controls: the
2-hour drop back on DROP_AFTER_MS fails the drop test; boxIsReason ignored fails four "keeps the day" tests; notices in
flight not counted fails the in-flight test.

### Per-Iteration Breakdown (fixes and deferrals are in each commit message, iterations 1 to 9)

#### Iteration 1
**Reviewer model:** opus
**New findings:** 4 WARNINGs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] a 2-hour drop for a message whose recipient is also limited --> FIXED (isLimited, later boxIsReason)
- [WARNING] the behind-receipt and CLI lines did not name the 2 hours --> FIXED
- [WARNING] a notice that did not land was lost --> FIXED (retried)
- [WARNING] tests did not drive the board's sweepHooks --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] an unreadable card failed open to the 2-hour drop --> FIXED (a doubt keeps the day)
- [WARNING] the 2 hours counted from arrival, not from when the box became the reason --> FIXED (limitedSeen)
- [WARNING] a notice could follow its own message, typed in the same sweep --> FIXED (said after typing)
- [WARNING] the told set leaked on some removal paths --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] "still waiting" was read as "the box is the reason" (menu, quota, a backlog draining) --> FIXED (boxIsReason reads the box)
- [WARNING] retries every minute could make the sender's stall streak --> FIXED (15 min spacing, refined later)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] the receipt promised "after 2 hours" unconditionally --> FIXED ("with the box still full")
- [WARNING] a board restart could drop a message on sight --> FIXED (the first sweep starts the clock)
- [WARNING] a second box read each minute --> DEFERRED: bounded to agents holding such a message, stated

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] a stale comment about retrying a minute on --> FIXED (cut to what the code does)
- [WARNING] the notice's drop time could move later --> FIXED (hedged)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] a task line's receipt promised the 2-hour drop --> FIXED (task: true)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] four "keeps the day" tests could not fail after the first-sweep rule --> FIXED (rebuilt; mutation turns them red)
- [WARNING] 15-minute spacing did not keep notices under a stall alert --> FIXED (one per sender per sweep; refined in 8)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 1 of the above (iteration 7's per-sender count)
- [WARNING] iteration 7's count could block a sender's notices for good --> FIXED (the sender's own deliverystreak decides)
- [WARNING] unconfirmed notices and other recipients escaped the cap --> FIXED (the streak counts every kind)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] a notice in flight was not counted --> FIXED (stillInFlight; mutation fails its test)
- [WARNING] an old streak withholds the 10-minute notice --> DEFERRED: decided and stated (the drop notice still comes)
- NITs: comment placement, duplicate export, the boundary test --> FIXED
Stopped here: round 8's blocker-class fix was reviewed; round 9 found no new defect in kind.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/limitqueue.js | BRANCH | 2-hour drop for a limited recipient | FIXED | iter 1, 3 |
| 2 | 2 | WARNING | engine/limitqueue.js | SELF | unreadable card failed open | FIXED | iter 2 |
| 3 | 3 | WARNING | engine/limitqueue.js | SELF | waiting read as box-held | FIXED | iter 3 |
| 4 | 4 | WARNING | engine/limitqueue.js | SELF | restart dropped on sight | FIXED | iter 4 |
| 5 | 7 | WARNING | engine/heldnote-7936.test.js | SELF | tests could not fail | FIXED | iter 7 |
| 6 | 8 | WARNING | engine/limitqueue.js | SELF | sender blocked for good | FIXED | iter 8 |
| 7 | 9 | WARNING | engine/limitqueue.js | SELF | in-flight notice uncounted | FIXED | iter 9 |
| 8 | 9 | WARNING | engine/limitqueue.js | BRANCH | old streak withholds the notice | DEFERRED | decided, in the plan |

### Strengths
- Every doubt keeps the day; the 2-hour rule applies only when the box is positively read as holding text
- Tests drive the board's real sweepHooks, each with a control; three mutations turn them red
- Task lines and a person's DMs are untouched; both CLIs and the server receipt say the same words
