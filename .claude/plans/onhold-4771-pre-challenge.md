---
pre_challenge: true
method: challenge-loop
branch: onhold-4771
diff_hash: 4971098033430f84a6915e03ac6aa8b6d2886ccf7f7f13b5d10959890eed7e74
validation: focused per round (engine/onhold-4771, assigner, agentnudge, projects, tasks, tasks.built-3951, both CLI suites, server.test.js #4771, render-onhold-4771.js and render-tasks-view-3559.js browser checks, both browser-check gates); static set on the main-merged tree 2613/2613; the FULL suite runs on Mortals on this head after this commit, result in the PR
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-09-30T21:40:06Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14 (reviewer model alternated: opus on odd rounds, sonnet on even)
**Converged:** Yes, at iteration 14 (NITs only)
**Total findings:** 0 BLOCKERs, 25 WARNINGs acted on or deferred as distinct (repeats counted once), 1 CONVENTION deferred, about 30 NITs
**Fixed:** 19 | **Deferred:** 7 distinct | **Asked (awaiting user):** 0

**Deviation, stated:** per-round validation was the focused set named above, not the full suite; the full suite is
queued once on the converged head. After iteration 8 converged, main was merged (14 commits) and two guards met
(README index; engine.reachable, which removed projects.setPaused); iterations 9 to 14 reviewed the result. The
final merge of 2 main commits left the branch's 1150 changed lines identical (compared line for line).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] install/kosmos:2852: hold/unhold help sat between built and its --clear --> FIXED (3d067e82b)
- [WARNING] install/kosmos:2925: task list did not mark held work --> FIXED (3d067e82b, both CLIs)
- [WARNING] engine/tasks.js:725: a hold recorded no author --> FIXED (3d067e82b: via screen or agent)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] engine/agentnudge.js:64: other automated paths --> FIXED (b5d99cc66: the agents' instructions marked held work)
- [WARNING] engine/tasks.js:1066: held before built, untested --> FIXED (b5d99cc66: pinned by a test)
- [WARNING] server.js:16871: the hold route has no authorisation --> DEFERRED: as its sibling /due; who did it is recorded
- [WARNING] engine/assigner.js:94: an agent with only held work gets new work --> DEFERRED: the plan's weakest premise

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (the instructions marker, from iteration 2)
- [WARNING] server.js:16870: a hold did not re-tell the assignees --> FIXED (111dc41b8)
- [WARNING] server.js:15736: a pause did not re-tell the members --> FIXED (111dc41b8)
- [WARNING] server.js:15758: a comment said a save had nothing to re-tell --> FIXED (111dc41b8)
- [CONVENTION] .claude/plans/onhold-4771.md: no timestamp in the plan's name --> DEFERRED: the pre-challenge gate requires .claude/plans/<branch>.md

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] server.js:16867: an agent could lift the person's hold --> FIXED (86abb1fb2: onHoldByPerson, 403)
- [WARNING] engine/assigner.js:164: held task and the goal ask, unpinned --> FIXED (86abb1fb2: test)
- [WARNING] engine/tasks.js:1066: a paused project hides states --> DEFERRED: decided and pinned

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the person's hold, from iteration 4)
- [WARNING] server.js:15738: a pause had none of a hold's protection --> FIXED (b40a6d586: pausedByPerson, 403)
- [WARNING] server.js:16869: the screen test is advisory, unsaid --> FIXED (b40a6d586: route comment and plan, #4491)
- [WARNING] server.js:16869: no membership check or valve --> DEFERRED: as /due; the plan records it

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (from iteration 4)
- [WARNING] engine/tasks.js:724: an agent's hold first left the person's hold liftable --> FIXED (05b874b94: takeover)
- [WARNING] engine/assigner.js:164: an idle agent with only held work --> DEFERRED: decided, in the plan

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 (the instructions wording)
- [WARNING] engine/projects.js:2948: "the person parked it" for an agent's hold --> FIXED (c27ff0033)
- [WARNING] engine/tasks.js:497: a hold survived closing the task --> FIXED (c27ff0033: both close paths)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 (three WARNINGs, all duplicates of deferred items)
**Converged**, then main was merged and two guards met (710eb265c, 255a198a2).

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (from iteration 7)
- [WARNING] engine/tasks.js:307: a part-close recorded the dropped hold before the close --> FIXED (898d0fd8a)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Duplicates of prior findings:** 2
- [WARNING] server.js:15740: an agent's pause read like the person's --> FIXED (314ecbd2c: "An agent paused it.")

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] install/kosmos:2968: the Mac CLI's hold and list marker untested --> FIXED (372e78426: cli.task-hold-4771.test.js)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (plan prose)
**Duplicates of prior findings:** 2
- [WARNING] engine/tasks.js:1098: the plan said a pause holds every task; decision stays first --> FIXED (19060a212: wording narrowed, test)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] engine/tasks.js:504: the Assigner's write-time recheck missed a hold or pause --> FIXED (873172342)
- [WARNING] engine/assigner.js:133: subtasks of a held parent --> DEFERRED: decided in the plan (a hold covers its own task), overridable

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/kosmos:2852 | BRANCH | help order | FIXED | 3d067e82b |
| 2 | 1 | WARNING | install/kosmos:2925 | BRANCH | list marker | FIXED | 3d067e82b |
| 3 | 1 | WARNING | engine/tasks.js:725 | BRANCH | hold author | FIXED | 3d067e82b |
| 4 | 2 | WARNING | engine/agentnudge.js:64 | BRANCH | instructions | FIXED | b5d99cc66 |
| 5 | 2 | WARNING | engine/tasks.js:1066 | BRANCH | held before built | FIXED | b5d99cc66 |
| 6 | 2 | WARNING | server.js:16871 | BRANCH | route auth | DEFERRED | as /due |
| 7 | 2 | WARNING | engine/assigner.js:94 | BRANCH | busy rule | DEFERRED | weakest premise |
| 8 | 3 | WARNING | server.js:16870 | SELF | hold re-tell | FIXED | 111dc41b8 |
| 9 | 3 | WARNING | server.js:15736 | BRANCH | pause re-tell | FIXED | 111dc41b8 |
| 10 | 3 | WARNING | server.js:15758 | BRANCH | false comment | FIXED | 111dc41b8 |
| 11 | 3 | CONVENTION | .claude/plans/onhold-4771.md | BRANCH | plan name | DEFERRED | gate requires it |
| 12 | 4 | WARNING | server.js:16867 | BRANCH | person's hold | FIXED | 86abb1fb2 |
| 13 | 4 | WARNING | engine/assigner.js:164 | BRANCH | goal ask pinned | FIXED | 86abb1fb2 |
| 14 | 5 | WARNING | server.js:15738 | BRANCH | person's pause | FIXED | b40a6d586 |
| 15 | 5 | WARNING | server.js:16869 | SELF | advisory unsaid | FIXED | b40a6d586 |
| 16 | 5 | WARNING | server.js:16869 | BRANCH | no valve | DEFERRED | as /due |
| 17 | 6 | WARNING | engine/tasks.js:724 | SELF | takeover | FIXED | 05b874b94 |
| 18 | 7 | WARNING | engine/projects.js:2948 | SELF | wording | FIXED | c27ff0033 |
| 19 | 7 | WARNING | engine/tasks.js:497 | BRANCH | hold outlives close | FIXED | c27ff0033 |
| 20 | 9 | WARNING | engine/tasks.js:307 | SELF | event order | FIXED | 898d0fd8a |
| 21 | 10 | WARNING | server.js:15740 | BRANCH | agent's pause | FIXED | 314ecbd2c |
| 22 | 11 | WARNING | install/kosmos:2968 | BRANCH | Mac CLI untested | FIXED | 372e78426 |
| 23 | 12 | WARNING | engine/tasks.js:1098 | SELF | plan overstated | FIXED | 19060a212 |
| 24 | 13 | WARNING | engine/tasks.js:504 | BRANCH | give race | FIXED | 873172342 |
| 25 | 13 | WARNING | engine/assigner.js:133 | BRANCH | subtasks | DEFERRED | decided in plan |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/assigner.js:94: inline require('./projects') in loops, the file's existing style (iterations 4, 8, 14)
- [NIT] web/index.html:53771: the hold button acts on the state as last read (iterations 7, 11)
- [NIT] server.js:16883: a hold on an archived project's task is accepted, harmless (iteration 14)
- [NIT] engine/projects.js:2473: a pause leaves no activity record; who paused it shows while it lasts (iteration 13)

### Strengths (across all iterations)
- Every reader (the Prompter, the Assigner's busy count, pick, goal ask and give, the instructions, both CLIs, taskState) uses one predicate pair, isOnHold and isPaused (every iteration)
- Each "not touched" test has a control on the same subject, off hold or resumed, that is touched (every iteration)
- Records written before this read as not held: the fields are stored only when true (every iteration)
