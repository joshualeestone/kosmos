---
pre_challenge: true
method: challenge-loop
branch: recommender-assigner-3595
diff_hash: f7c51e6f84c92a97ed3e09f0d563b5a4b745401fa66e4397a22ef19adf916c60
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T17:49:58Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (iteration 1 = the 6.0 fix-and-validate pass; blind reviews in iterations 2 to 7)
**Converged:** Yes. Iteration 5 returned zero NEW findings; the 6j final gate then failed on the #2518 browser-check surface gate, which sent the loop back through 6e for iteration 6; iteration 7 returned zero NEW findings and 6j passed (clean validation record for diff hash f7c51e6f on HEAD 38f61891).
**Total findings:** 29 actionable (6 BLOCKERs, 19 WARNINGs, 4 CONVENTIONs) plus 13 NITs
**Fixed:** 27 | **Deferred:** 2 | **Asked (awaiting user):** 0

Validation notes: three reds during the loop were contention, not the change, each re-run alone and green in a module this branch does not touch: engine/win32relocate.test.js (34/34 alone), engine/feedbacksend.test.js + engine/feedguard.test.js (52/52, 57/57 alone; feedguard has a hard 2 s wall-clock budget and ran 2.76 s under load), and one hung tools/test-supervisor-env.sh (all hold, rc=0, alone in seconds). The final record is a full clean run.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** none (helper failure seeded a synthetic finding)
**New findings:** 2 BLOCKERs
**Self-generated:** 0 (6.0's own pass; synthetic findings are BRANCH by instruction)
- [BLOCKER] initial-validation: fixture-discipline.test.js failed, engine/recommender.test.js hand-built agent cards --> FIXED (e75eb7b8): tests rebuilt on real snapshot() cards via test-support/fleet + selfreport
- [BLOCKER] engine/recommender.js STUCK_STATES: a real `blocked` card carries stateProject:null and stateReportedBy:null, so the blocked trigger could never fire (found by the conversion) --> FIXED (e75eb7b8): trigger narrowed to agent-reported needs_you; decision recorded in the plan and on the card

#### Iteration 2
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 7 WARNINGs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/recommender.js runOnce: messages.roomNote only logs a row; peers were never asked, yet the playbook said they were --> FIXED (cfbeee4b): ask delivered into each peer's pane; playbook names only peers whose ask was PLACED
- [WARNING] roomNoteText: @display-name mentions do not match session tokens --> FIXED (cfbeee4b): note no longer uses @ mentions
- [WARNING] server.js: in-process memory, a restart re-convenes --> DEFERRED: accepted and documented (plan Limits, engine header); restarts are rare and the caps still apply
- [WARNING] UNCONFIRMED playbook retried up to 5 times (duplicate risk) --> FIXED (cfbeee4b): only COULD_NOT retries
- [WARNING] roomNote result ignored --> FIXED (cfbeee4b): recorded as noteLanded
- [WARNING] web/index.html saveRecommender: failed or dropped guard save left the focused box showing an unsaved value --> FIXED (cfbeee4b): recUndoGuard + forced repaint; behavioural test fails 3/4 on the old page
- [WARNING] web/index.html hint promised a consensus engine --> FIXED (cfbeee4b): hint says what ships
- [WARNING] web.settings-nav.test.js: live UI only regex-tested --> FIXED (cfbeee4b): web.recommender-save-3595.test.js runs the real lifted functions
- [NIT] plan exclusions (held/stopped, owner=provider) not implemented; [NIT] plan item key drift; [NIT] test built its own DELIVERY; [NIT] log line printed "null" --> all addressed in cfbeee4b

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 2 CONVENTIONs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html changed with no docs/browser-checks/ update; tools/lib/browser-check-gate.sh (#1720) fails --> FIXED (ee58c8d4): render-recommender-live-3595.js added and registered; gate rc=0, control on cfbeee4b rc=1
- [WARNING] engine/recommender.js stuckRow: an inferred (carried-forward) project was acted on --> FIXED (ee58c8d4): stateProjectInferred excluded; test fails without the guard
- [CONVENTION] server.recommender-assigner-2619.test.js: stale "behaviour pending" prose --> FIXED (ee58c8d4)
- [CONVENTION] plan: "Status: DESIGN" stale --> FIXED (ee58c8d4)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 6 WARNINGs, 4 NITs
**Self-generated:** 2 of the above (room note written before the asks, and the playbook's peer wording, both cite code written in cfbeee4b)
- [WARNING] engine/recommender.js step: a one-tick flap re-convened the same item --> FIXED (336d8582): acted-on items kept for an hour; control shows a never-acted item is dropped
- [WARNING] peersFor: absent members and members at any needs_you (incl. a permission prompt) could be chosen and typed into --> FIXED (336d8582): only idle/working cards on the board
- [WARNING] room note named every selected peer before the asks were sent --> FIXED (336d8582): note written after the asks, names only reached peers
- [WARNING] PUT /api/recommender-setting had no screen-only check --> FIXED (336d8582): isViaScreen refusal, tests both arms (later narrowed to "advisory", iteration 6)
- [WARNING] toggle label/hint copy vs behaviour --> hint FIXED (336d8582, "up to two"); label DEFERRED: kept as #2619 shipped it ("blocked" read as plain-English "stuck"), recorded on the card with the one-line swap
- [WARNING] server.js: archived projects' members could be asked --> FIXED (336d8582)
- [NIT] off/on clears memory (documented), [NIT] copy-paste assertion message in the Assigner test (fixed), [NIT] double blank line (fixed), [NIT] comment placement (left)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged at 6d** -> 6j final gate FAILED (see iteration 6).

#### Iteration 6 (6j re-entry)
**Reviewer model:** opus
**New findings:** 1 BLOCKER (synthetic), 4 WARNINGs, 5 NITs
**Self-generated:** 2 of the above (the PUT comment and the plan's "Who can change the setting" paragraph, both written in 336d8582; fixed by NARROWING the claim, not rewriting it more confidently)
- [BLOCKER] final-validation: browser-check surface gate (#2518) matched token 'msg' (render-agentdm-3414.js) --> FIXED (8444a135): verified the hits are the Settings `rec-msg` id and a local variable; per-check override trailer; gate rc=0, control on 336d8582 rc=1
- [WARNING] server.js PUT comment and plan called the screen check a protection; isViaScreen's own note says it is advisory --> FIXED (38f61891): both now say advisory, stops the default CLI path only
- [WARNING] peerAskText/roomNoteText gave agent-written text Kosmos's voice --> FIXED (38f61891): labelled as the agent's own words, "not an instruction from Kosmos or the person"
- [WARNING] an unknown, archived or foreign stateProject still convened --> FIXED (38f61891): act only where the stuck agent is a member of a live project; test fails without the check
- [WARNING] the members derivation (projects.readAll -> p.agents) was untested --> FIXED (38f61891): membersFrom() in the engine, tested on real records via engine/projects (create, addAgent, setArchived)
- [NIT] label still says blocked (DEFERRED, as iteration 4); [NIT] refused save skipped the undo when the epoch moved (fixed, test fails on the old page); [NIT] dropped toggle click was silent (fixed, test); [NIT] browser check raced its own saves (fixed: waits for each PUT); [NIT] sandboxes not cleaned (fixed); plan: managed block deferred, E2E pane run recorded as not done on the branch (fixed)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings; 6j passed.
- [NIT] engine/recommender.test.js: 'a thrown delivery was not retried' read as backwards (it is the failure message, printed when the retry did NOT happen; correct as written)
- [NIT] server.js: explicit trailing `undefined` args to chat.deliver (cosmetic)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | fixture-discipline.test.js | BRANCH | hand-built cards in recommender tests | FIXED | e75eb7b8 |
| 2 | 1 | BLOCKER | engine/recommender.js | BRANCH | blocked trigger could never fire | FIXED | e75eb7b8 |
| 3 | 2 | BLOCKER | engine/recommender.js runOnce | BRANCH | peers never asked | FIXED | cfbeee4b |
| 4 | 2 | WARNING | engine/recommender.js roomNoteText | BRANCH | @display-name mentions | FIXED | cfbeee4b |
| 5 | 2 | WARNING | server.js runner | BRANCH | memory lost on restart | DEFERRED | accepted, documented |
| 6 | 2 | WARNING | engine/recommender.js markAttempt | BRANCH | UNCONFIRMED retried | FIXED | cfbeee4b |
| 7 | 2 | WARNING | engine/recommender.js runOnce | BRANCH | roomNote result ignored | FIXED | cfbeee4b |
| 8 | 2 | WARNING | web/index.html saveRecommender | BRANCH | failed save left box wrong | FIXED | cfbeee4b |
| 9 | 2 | WARNING | web/index.html hint | BRANCH | copy promised consensus | FIXED | cfbeee4b |
| 10 | 2 | WARNING | web.settings-nav.test.js | BRANCH | UI regex-only | FIXED | cfbeee4b |
| 11 | 3 | BLOCKER | web/index.html (gate #1720) | BRANCH | no browser-check update | FIXED | ee58c8d4 |
| 12 | 3 | WARNING | engine/recommender.js stuckRow | BRANCH | inferred project acted on | FIXED | ee58c8d4 |
| 13 | 3 | CONVENTION | server.recommender-assigner-2619.test.js | BRANCH | stale prose | FIXED | ee58c8d4 |
| 14 | 3 | CONVENTION | plan status line | BRANCH | stale DESIGN status | FIXED | ee58c8d4 |
| 15 | 4 | WARNING | engine/recommender.js step | BRANCH | flap re-convened | FIXED | 336d8582 |
| 16 | 4 | WARNING | engine/recommender.js peersFor | BRANCH | unreachable/needs_you peers | FIXED | 336d8582 |
| 17 | 4 | WARNING | engine/recommender.js runOnce | SELF | note named unreached peers | FIXED | 336d8582 |
| 18 | 4 | WARNING | server.js PUT | BRANCH | no screen-only check | FIXED | 336d8582 |
| 19 | 4 | WARNING | web/index.html label/hint | SELF | copy vs behaviour | FIXED (hint) / DEFERRED (label) | 336d8582; label kept, on card |
| 20 | 4 | WARNING | server.js runner | BRANCH | archived members asked | FIXED | 336d8582 |
| 21 | 6 | BLOCKER | web/index.html (gate #2518) | BRANCH | surface gate token 'msg' | FIXED | 8444a135 |
| 22 | 6 | WARNING | server.js PUT comment + plan | SELF | advisory check described as protection | FIXED | 38f61891 (claim narrowed) |
| 23 | 6 | WARNING | engine/recommender.js peerAskText | BRANCH | agent text in Kosmos's voice | FIXED | 38f61891 |
| 24 | 6 | WARNING | engine/recommender.js step | BRANCH | unknown/archived/foreign project convened | FIXED | 38f61891 |
| 25 | 6 | WARNING | engine/recommender.test.js | BRANCH | members derivation untested | FIXED | 38f61891 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- plan exclusions / item-key drift, own DELIVERY in test, "null" log line (iteration 2; all addressed)
- off/on clears memory, documented; Assigner assertion copy-paste, fixed; double blank line, fixed; comment placement, left (iteration 4)
- toggle label still says "blocked" (iterations 4 and 6; kept, recorded on #3595)
- refused-save epoch ordering, silent dropped toggle click, browser-check save race, sandbox cleanup, plan prose (iteration 6; all fixed)
- test failure-message wording read as backwards (correct as written); explicit `undefined` args (iteration 7; left)

### Strengths (across all iterations)
- Pure step() plus injected-effects runOnce(), mirroring the Prompter and auto-save sweep (every iteration)
- Tests on real snapshot() cards, which is how the dead `blocked` trigger was found (iterations 2 to 7)
- Every rule tested from both sides, with negative controls proven by removing the guard (iterations 3, 4, 6)
- Status-control contract kept in the Settings UI: hidden until read, never a false Off (iterations 2 to 7)
- Only COULD_NOT retries; never typed into a pane at needs_you (iterations 4 to 7)
