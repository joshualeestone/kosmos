---
pre_challenge: true
method: challenge-loop
branch: agentactions-8955
diff_hash: b2ccdead70e29921142b477a18ce1994db801faa79851de9f48bf2ed6c60ca58
validation: failed (full suite passed 30798/0 at c98ea754d6; at the final head db9ab8e28a two runs on a loaded Mac each had unrelated timing reds, test-cut-claim-renew-5134 then kosmos-report-hook.exit-8014, both passing alone; diff is ios/ only; filed as kosmos#8965 and kosmos#8968; GitHub CI decides)
subdir_audit: passed
timestamp: 2026-11-24T06:29:48Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 found nothing new after deduplication: its two warnings are decisions the plan records; also the 8-round usage rule)
**Total findings:** 22 actionable (1 BLOCKER, 19 WARNINGs, 2 CONVENTIONs) plus NITs
**Fixed:** 18 | **Deferred:** 4 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 7 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above (no loop commit yet)
- [BLOCKER] ios/Kosmos/AgentInfoLogic.swift wakeHeldLine: limit checked before sign-in, so a signed-out agent read "out of usage" --> FIXED (c98ea754d6)
- [WARNING] AgentInfoLogic.swift wakeHeldLine: a limit past its reset said "out of usage" --> FIXED (c98ea754d6)
- [WARNING] AgentInfoLogic.swift removeResult: no answer said "nothing was removed" --> FIXED (c98ea754d6)
- [WARNING] AgentInfoLogic.swift removeResult: a 403 with words showed the gate's words --> FIXED (c98ea754d6)
- [WARNING] AgentInfoView.swift ready wait used refreshNow (re-sorts the list, can reconnect) --> FIXED (c98ea754d6)
- [WARNING] AgentInfoView.swift restart token per view, not per agent --> FIXED (c98ea754d6)
- [WARNING] AgentInfoView.swift loadRemoval had no newest-read token --> FIXED (c98ea754d6)
- [WARNING] AgentInfoView.swift Restart, Compact/Clear and Remove did not hold each other --> FIXED (c98ea754d6)
- [CONVENTION] plan: claimed the page names the set-up offer --> FIXED (c98ea754d6)
- [NIT] compactMap never returns nil --> FIXED (map)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 acted on as SELF (code findings fixed normally)
- [WARNING] AgentInfoView.swift restart() relied on inferred main-actor isolation --> FIXED (4faa287dcd)
- [WARNING] AgentInfoView.swift switch and Save not held during a restart or after removal --> FIXED (4faa287dcd)
- [WARNING] board-row footer did not name the untied clear-off --> FIXED (4faa287dcd)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 (a comment claiming the board writes nothing until the wake settles: deleted)
- [WARNING] restart dialog lacked the board's rst-cost line (they come back with nothing in their memory) --> FIXED (9882898693)
- [WARNING] a superseded restart left the older page held for good --> FIXED (9882898693)
- [WARNING] UI test failed hard on iOS before 26 (no popover region) --> FIXED (9882898693)
- [NIT] removalPlan 401/403 read as unreached --> FIXED; [NIT] restartLabel did not trim --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] several confirmationDialogs on one view node --> FIXED (24459abc77, each on its own button)
- [NIT] engine Loses/Keeps shown without cloudWords --> DEFERRED: the phone's other screens do not use it either; recorded in the plan
- [NIT] source-count checks are tripwires --> DEFERRED: deliberate, recorded in the plan

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (a comment overstating when a removal request may have gone out: deleted)
- [WARNING] UI test read isHittable on a row that may not exist --> FIXED (cfce579cf6)
- [WARNING] removal no-answer comment overstated --> FIXED (cfce579cf6, comment deleted)
- [NIT] pending removal dialog not cleared; sleep cancellation; save not holding Restart/Remove; missing tests --> FIXED (cfce579cf6)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] footer did not name the set-up offer for an agent with no way to start --> FIXED (d994e1e7a2)
- [WARNING] a plan read could land mid-removal and close the dialog --> FIXED (d994e1e7a2)
- [NIT] 401/403 with a non-JSON body read as unreached --> FIXED (d994e1e7a2)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (header comment overstating where the words come from: cut)
- [WARNING] a gateway 5xx with no JSON read as a refusal on DELETE and restart --> FIXED (db9ab8e28a)
- [WARNING] keep-a-shown-plan rule covered only by source text --> FIXED (db9ab8e28a, Board.removalNext tested by behaviour)
- [NIT] restart token keyed by session only --> FIXED (keyed by computer and session)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after deduplication, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] restart wait outlives the page --> DEFERRED: by design, the plan's per-agent token outliving the page (RESTART_HELLO_SEQ)
- [WARNING] page stays after a removal --> DEFERRED: by design, the plan's rejected alternative (#8055 close detection)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | AgentInfoLogic.swift wakeHeldLine | BRANCH | sign-in after limit | FIXED | c98ea754d6 |
| 2 | 1 | WARNING | AgentInfoLogic.swift wakeHeldLine | BRANCH | limit past reset | FIXED | c98ea754d6 |
| 3 | 1 | WARNING | AgentInfoLogic.swift removeResult | BRANCH | no answer said nothing removed | FIXED | c98ea754d6 |
| 4 | 1 | WARNING | AgentInfoLogic.swift removeResult | BRANCH | 403 showed gate words | FIXED | c98ea754d6 |
| 5 | 1 | WARNING | AgentInfoView.swift restart | BRANCH | wait used list refresh | FIXED | c98ea754d6 |
| 6 | 1 | WARNING | AgentInfoView.swift restart | BRANCH | token per view | FIXED | c98ea754d6 |
| 7 | 1 | WARNING | AgentInfoView.swift loadRemoval | BRANCH | no newest-read token | FIXED | c98ea754d6 |
| 8 | 1 | WARNING | AgentInfoView.swift | BRANCH | actions did not hold each other | FIXED | c98ea754d6 |
| 9 | 1 | CONVENTION | plan | BRANCH | set-up offer claim | FIXED | c98ea754d6 |
| 10 | 2 | WARNING | AgentInfoView.swift restart | SELF | main-actor inference | FIXED | 4faa287dcd |
| 11 | 2 | WARNING | AgentInfoView.swift | BRANCH | switch/Save not held | FIXED | 4faa287dcd |
| 12 | 2 | WARNING | AgentInfoLogic.swift footer | BRANCH | untied clear-off unnamed | FIXED | 4faa287dcd |
| 13 | 3 | WARNING | AgentInfoView.swift dialog | BRANCH | rst-cost line missing | FIXED | 9882898693 |
| 14 | 3 | WARNING | AgentInfoView.swift restart | SELF | superseded page held | FIXED | 9882898693 |
| 15 | 3 | WARNING | AgentActionsUITests.swift | SELF | pre-26 dialog shape | FIXED | 9882898693 |
| 16 | 4 | WARNING | AgentInfoView.swift dialogs | BRANCH | several dialogs on one node | FIXED | 24459abc77 |
| 17 | 5 | WARNING | AgentActionsUITests.swift | SELF | isHittable on missing row | FIXED | cfce579cf6 |
| 18 | 5 | WARNING | AgentInfoLogic.swift comment | SELF | overstated claim | FIXED | cfce579cf6 |
| 19 | 6 | WARNING | AgentInfoLogic.swift footer | BRANCH | set-up offer unnamed | FIXED | d994e1e7a2 |
| 20 | 6 | WARNING | AgentInfoView.swift loadRemoval | SELF | read lands mid-removal | FIXED | d994e1e7a2 |
| 21 | 7 | WARNING | AgentInfoLogic.swift results | SELF | gateway 5xx read as refusal | FIXED | db9ab8e28a |
| 22 | 7 | WARNING | agentinfo main.swift | SELF | keep-plan rule untested by behaviour | FIXED | db9ab8e28a |
| 23 | 8 | WARNING | AgentInfoView.swift restart | BRANCH | wait outlives page | DEFERRED | by design (plan) |
| 24 | 8 | WARNING | AgentInfoView.swift remove | BRANCH | page stays after removal | DEFERRED | by design (plan) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Restart button's accessibility label "Fresh start: Restart: ..." mirrors the board's aria-label (iterations 1, 6)
- Removal plan reread on pull to refresh, where the board reads it on open only (iteration 3; recorded in the plan)
- Board.Agent equality now changes with commitments (iteration 3)
- Restart/Remove dialog titles use the untrimmed name, as the board does (iteration 5)
- Removed page still shows its board row (iteration 7)
- Phone holds the page for the whole ready wait (iteration 7; plan)
- removeAsk captured at tap keeps the older plan's words if a refresh changes it (iteration 7)

### Strengths (across all iterations)
- Restart and removal rules are small pure Board functions with negative controls beside each (every iteration)
- The suite pins the board's own sentences in web/index.html and engine/remove.js, so wording drift turns it red (iterations 1, 2, 7)
- A restart counts only on outcome "restarted"; a hello is claimed only when placed; an unreadable answer is never a fact about the agent (iterations 2, 5, 8)
