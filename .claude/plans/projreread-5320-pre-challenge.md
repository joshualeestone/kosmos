---
pre_challenge: true
method: challenge-loop
branch: projreread-5320
diff_hash: ad2e0dc667a7560ef0dea5ef436aa154e6b987188ca94afd037eb7094ff45ca0
validation: passed (Mortals full suite, 15876 tests, 0 fail, 2026-10-06 12:13 CDT; local helper skipped on that clean entry)
subdir_audit: passed
timestamp: 2026-10-06T17:16:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 30 (0 BLOCKERs, 17 WARNINGs, 1 CONVENTION, 12 NITs)
**Fixed:** 13 | **Deferred:** 5 (documented as known limits or by design) | **Asked (awaiting user):** 0

Note on 6.0: the initial validation was not run locally (a full local suite on the shared Agent1s is a queue
violation); the full suite ran once at convergence on Mortals (the 6j gate), and every iteration ran the focused
test files (engine/projects.test.js, engine/instructionreread.test.js, engine/instructionreread-sections-5304.test.js)
plus a red control for each fix.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] engine/projects.js:3534 (syncAgent) - the agent's own task close changed the block and owed a needless re-read turn --> FIXED (50a592231: owe only when a standing rule changes)
- [WARNING] engine/projects.js:3534 - joining double-told (membershipLine already points at the section) --> FIXED (50a592231: no old block, nothing owed)
- [WARNING] engine/projects.js:3534 - leaving the last project owed a re-read of a section that is gone --> FIXED (50a592231)
- [WARNING] engine/projects.js:3530 - no board-start sweep; agents whose file already got the pause line are never owed --> DEFERRED: a sweep cannot tell what a running session read; stated as a known limit in the plan (9d21b7d0b)
- [WARNING] engine/projects.test.js:835 - test covered only first-write and unchanged arms --> FIXED (50a592231: join, upgrade, unchanged, task arrive, own close, leave arms)
- [NIT] engine/projects.js:3535 - a lost debt was silent --> FIXED (logged to stderr like its siblings)
- [NIT] engine/projects.js:3531 - comment read as though stale agents were fixed --> FIXED (comment rewritten)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the tasks-rules condition written in iteration 1)
- [WARNING] engine/projects.js:3280 (rulesChangedIn) - older tasks wording rewritten as the last task closed owed rules the new block no longer carries --> FIXED (da4074f43: compare only rules the new block carries; e81177cc3 dropped a redundant guard so the remaining one is red-capable)
- [WARNING] engine/projects.js:3280 - "rules changed" is really "rules added" --> FIXED (comment says only additions count)
- [WARNING] engine/projects.js:3280 - a CLI spelling change owes every member once --> DEFERRED: wanted (the command the agent copies changed); recorded in the plan (1b5667853)
- [WARNING] engine/projects.js:3556 - a debt that cannot be recorded is not retried --> DEFERRED: sibling pattern; recorded as a known limit in the plan
- [NIT] engine/projects.js:3558 - stderr wording --> FIXED
- [NIT] engine/projects.test.js - tasks-rules branch untested --> FIXED (new test: owed beside an open task, not owed as the last closes; red with the tasks rules never compared)
- [NIT] .claude/plans/projreread-5320.md - record cliShown and removal behaviour --> FIXED (1b5667853)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/projects.js:3388 - a pause made on the screen marks task lines and posts no room note, so a running agent never learned it --> FIXED (f6b58e66a: a changed hold marker on a task both blocks list owes the re-read; red without the hold compare)
- [WARNING] engine/projects.js:3233 - blockRules comment overclaimed coverage (per-project commands are not compared) --> FIXED (comment and plan name the exclusion)
- [WARNING] engine/projects.js:3385 - pre-#779 task spelling not read as tasks --> DEFERRED: fails toward silence, never noise; recorded as a known limit (6659e6977)
- [NIT] engine/projects.js:3386 - kosmosCliShown called twice --> DEFERRED: same process, same moment; negligible
- [NIT] engine/projects.js:3419 - rulesChanged on the wire --> DEFERRED: matches changed/added; stripped before storing
- [NIT] plan - stderr prefix --> no change (cosmetic)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (actionable), 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (holdsOf's key, written in iteration 3)
- [WARNING] engine/projects.js:3283 - a pause and a reword in one write changed the whole-line key and the pause was missed --> FIXED (5ad09395f: key "task <n> of <project>"; red with the whole-line key)
- [WARNING] marker regex assumptions; task first appearing held; write ordering --> DEFERRED (marker appended last by construction; the assignment announces a held task; ordering harmless, as the reviewer noted)
- [NIT] x4 (cliShown, oweNow wording, non-TOLD guard untested, shared debt file) --> no change

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the key from iteration 4)
- [WARNING] engine/projects.js:3296 - two projects with one name (or ": " in a name) share a key; the second line overwrote the first --> FIXED (ce194a8f3: a sorted list of markers per key, compared when both blocks have as many; 345ec81a9 made the test pause the first-listed project so an overwrite fails it; red both ways)
- [WARNING] plan understated who gets the line after `kosmos project pause` --> FIXED (35d5bdc78: every member with an open task there, redundant beside the room note, accepted)
- [NIT] rename and pause in one request --> FIXED (recorded as a known limit)
- [NIT] marker text inside a task sentence; rulesChanged on the wire --> no change

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (new), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] marker text inside a task sentence --> DEFERRED (duplicate of iteration 5's NIT): webhook text has every bracket replaced (tasks.forAgent), so only a person or agent could type it, and the failure is one extra re-read line
- [WARNING] tasks rules depend on blockBody internals --> no change: the reviewer confirmed it is consistent and covered by the second test
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/projects.js:3534 | BRANCH | own task close owed a turn | FIXED | 50a592231 |
| 2 | 1 | WARNING | engine/projects.js:3534 | BRANCH | join double-told | FIXED | 50a592231 |
| 3 | 1 | WARNING | engine/projects.js:3534 | BRANCH | leave owed a gone section | FIXED | 50a592231 |
| 4 | 1 | WARNING | engine/projects.js:3530 | BRANCH | no board-start sweep | DEFERRED | known limit |
| 5 | 1 | WARNING | engine/projects.test.js:835 | BRANCH | arms missing | FIXED | 50a592231 |
| 6 | 2 | WARNING | engine/projects.js:3280 | SELF | rules the new block lacks were owed | FIXED | da4074f43, e81177cc3 |
| 7 | 2 | WARNING | engine/projects.js:3280 | SELF | "changed" vs "added" | FIXED | da4074f43 |
| 8 | 2 | WARNING | engine/projects.js:3280 | SELF | CLI spelling change owes all | DEFERRED | by design, in plan |
| 9 | 2 | WARNING | engine/projects.js:3556 | BRANCH | no retry on a lost debt | DEFERRED | known limit |
| 10 | 3 | WARNING | engine/projects.js:3388 | BRANCH | screen pause never reached agents | FIXED | f6b58e66a |
| 11 | 3 | WARNING | engine/projects.js:3233 | SELF | blockRules comment overclaimed | FIXED | f6b58e66a |
| 12 | 3 | WARNING | engine/projects.js:3385 | SELF | pre-#779 spelling | DEFERRED | known limit |
| 13 | 4 | WARNING | engine/projects.js:3283 | SELF | whole-line key missed reword+pause | FIXED | 5ad09395f |
| 14 | 5 | WARNING | engine/projects.js:3296 | SELF | shared key overwrote | FIXED | ce194a8f3, 345ec81a9 |
| 15 | 5 | WARNING | plan | SELF | who gets the pause line | FIXED | 35d5bdc78 |

### NITs (non-blocking, across all iterations)
- kosmosCliShown called twice in one write (iterations 3, 4)
- rulesChanged visible in HTTP verdicts beside changed/added (iterations 3, 5, 6)
- the TOLD guard on rulesChanged has no test of its own (iteration 4)
- marker text could appear inside a hand-typed task sentence (iterations 5, 6)

### Strengths (across all iterations)
- blockBody output is byte-for-byte unchanged by the blockRules refactor (iterations 2, 3, 5, 6)
- the owe is best-effort and can never fail the instructions write; a lost debt is logged (all)
- every test asserts its own fixture and carries a control; each fix was shown red without it (iterations 3-6)

### Validation at convergence
- Mortals full suite at 35d5bdc78: 15876 tests, 15644 pass, 0 fail, 0 cancelled; entry status clean (not skipped).
- Merged with origin/main as of 12:15 (42 commits ahead, incl. #4787 repeating tasks and a projects.test.js change), in
  a throwaway worktree: projects, instructionreread (both files), tasks.repeat-4787, taskrepeat and server.task-repeat-4787
  tests 223/223.
