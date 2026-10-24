---
pre_challenge: true
method: challenge-loop
branch: replaced-6923
diff_hash: 72f27db4c18f152a6738fcda73282107169a3ae5a679e28df51c43c2f3ead756
validation: focused only (2597 tests: every test naming the history phrases, the state word, the task card, the task row, the close route, tasks.close or task close, the receipt and task-page lifts, plus the standing file-scanning guards; 0 failed, on the branch rebased onto origin/main); the full local run has been queuing an hour or more today, so CI is the full gate
subdir_audit: passed
timestamp: 2026-10-22T20:46:24Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the operator usage cap after iteration 8: Splinter's 11:08 rule caps review loops at 8 rounds and allows more only while a BLOCKER is open; none was open)
**Total findings:** 1 BLOCKER, 22 WARNINGs, 2 CONVENTIONs, plus NITs
**Fixed:** 18 | **Deferred:** 3 | **Asked (awaiting user):** 0 | **Left for follow-up card:** 5 (kosmos#6936)

Design review (Mona Lisa) ran beside the loop: approved with two changes (task numbers as links; no summary line under
the history), both made; the Tasks view line approved as plain text. Shots: ~/work/design-shots/kosmos-6923/.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] install/kosmos:5651 — Mac CLI sent {"replacedBy":02}, invalid JSON, closed as done --> FIXED (0becfd24, number sent as text)
- [WARNING] server.js:22371 — an unreadable body was taken as a plain close --> FIXED (0becfd24, 400)
- [WARNING] install/kosmos:5486, kosmos-cli.js:981 — task list said [done] --> FIXED (0becfd24, [replaced by N])
- [WARNING] engine/tasks.js:957 — a plain re-close dropped the link silently --> FIXED (0becfd24, a plain close keeps it)
- [WARNING] engine/tasks.js:952 — two tasks could replace each other --> FIXED (0becfd24)
- [NIT] shot cleanup status, stale route comment, phrase guard --> FIXED (0becfd24)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] web/index.html:11222 — the new look draws the card label in CSS --> FIXED (cf0de143), later removed as dead code (496b9a32)
- [WARNING] web/index.html:68036 — a parent's subtask list said Done --> FIXED (cf0de143, "Replaced")
- [WARNING] plan — said a plain close clears the link --> FIXED (cf0de143)
- (found while shooting) finished tasks live on the Tasks view, not the column --> FIXED (ed2033f5, "Replaced by task N" under the row)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/tasks.js:949 — marking an already-closed task moved its finish time --> FIXED (62fe2b95)
- [WARNING] web/index.html:67914 — the state row was rewritten every poll (focus) --> FIXED (62fe2b95)
- [WARNING] web/index.html — no node test for the page changes --> FIXED (62fe2b95, state row and history link tests)
- [WARNING] server.js:22378 — a misspelled key closed as done --> FIXED (62fe2b95, only { replacedBy } accepted)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/tasks.js:289 — longer loops accepted --> FIXED (3e28abda, any length refused)
- [WARNING] engine/tasks.js:287 — the link is never re-checked --> DEFERRED: documented as a point in time in the plan
- [WARNING] web/index.html:67297 — stale link after a part reopen --> DEFERRED: cannot happen (round 5 confirmed closedAt wins)
- [NIT] paint guard compared re-serialised HTML; link keyed on wording; re-point test --> FIXED (3e28abda)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] plan — claimed a reopened part leaves an unseen link; it cannot --> FIXED (177e9dba, sentence deleted)
- [NIT] Replaces lists only closed tasks; test title --> FIXED (177e9dba); Mac number as JSON number --> tried and reverted (bash arithmetic wraps on long input)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] both CLIs — claimed a link an older board did not record --> FIXED (131a5f27, says so and exits 1; Windows tested against a stand-in older board)
- [WARNING] card label two copies of the rule; point-in-time link; closedAt-only counts --> DEFERRED: covered by the plan's stated limits (card later removed)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 2 of the above
- [WARNING] web/index.html — card label, subtask word, Tasks row untested --> FIXED (496b9a32): the card change removed as dead code (the column never shows a finished task); tests for the subtask word and the Tasks row
- [WARNING] install/kosmos:5662 — the Mac older-board branch is untested --> residual: the Mac CLI health-checks the board first, so it cannot be pointed at a stand-in; the same rule as Windows, read from the board's reply
- [NIT] double full stop before Replaces; null replacedBy in the plan --> FIXED (496b9a32)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] loop walk relies on "an open task never carries replacedBy" --> LEFT for kosmos#6936
- [WARNING] older-board message does not say to reopen --> LEFT for kosmos#6936
- [WARNING] replaced subtasks count as done in a parent's counts --> LEFT for kosmos#6936 (the plan's stated choice)
- [NIT] comment placement; 400 wording --> LEFT for kosmos#6936
**Stopped:** operator usage cap at 8 rounds, no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | install/kosmos:5651 | SELF | 02 sent as invalid JSON | FIXED | 0becfd24 |
| 2 | 1 | WARNING | server.js:22371 | SELF | unreadable body = plain close | FIXED | 0becfd24 |
| 3 | 1 | WARNING | install/kosmos:5486 | BRANCH | list said [done] | FIXED | 0becfd24 |
| 4 | 1 | WARNING | engine/tasks.js:957 | SELF | plain re-close dropped link | FIXED | 0becfd24 |
| 5 | 1 | WARNING | engine/tasks.js:952 | SELF | mutual replace | FIXED | 0becfd24 |
| 6 | 2 | WARNING | web/index.html:11222 | BRANCH | CSS-drawn card label | FIXED | cf0de143, removed 496b9a32 |
| 7 | 2 | WARNING | web/index.html:68036 | BRANCH | subtask said Done | FIXED | cf0de143 |
| 8 | 2 | WARNING | plan | SELF | plain close claim | FIXED | cf0de143 |
| 9 | 3 | WARNING | engine/tasks.js:949 | SELF | finish time moved | FIXED | 62fe2b95 |
| 10 | 3 | WARNING | web/index.html:67914 | SELF | focus lost on poll | FIXED | 62fe2b95 |
| 11 | 3 | WARNING | web/index.html | SELF | page changes untested | FIXED | 62fe2b95 |
| 12 | 3 | WARNING | server.js:22378 | SELF | misspelled key closed | FIXED | 62fe2b95 |
| 13 | 4 | WARNING | engine/tasks.js:289 | SELF | longer loops | FIXED | 3e28abda |
| 14 | 4 | WARNING | engine/tasks.js:287 | SELF | link not re-checked | DEFERRED | plan: point in time |
| 15 | 4 | WARNING | web/index.html:67297 | SELF | part reopen staleness | DEFERRED | cannot happen |
| 16 | 5 | WARNING | plan | SELF | false claim | FIXED | 177e9dba |
| 17 | 6 | WARNING | both CLIs | SELF | false success on older board | FIXED | 131a5f27 |
| 18 | 7 | WARNING | web/index.html | SELF | untested screens | FIXED | 496b9a32 |
| 19 | 7 | WARNING | install/kosmos:5662 | SELF | Mac older-board untested | DEFERRED | cannot stand in for the board |
| 20 | 8 | WARNING | engine/tasks.js | SELF | loop walk invariant | LEFT | kosmos#6936 |
| 21 | 8 | WARNING | both CLIs | SELF | reopen hint | LEFT | kosmos#6936 |
| 22 | 8 | WARNING | engine/tasks.js | BRANCH | subtask counts | LEFT | kosmos#6936 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] comment placement above repeatLine; 400 wording for an extra key (iteration 8, on kosmos#6936)
- [NIT] the Mac list formatter one-liner keeps growing (iteration 6)

### Strengths (across all iterations)
- Validation (self, missing, loops of any length) inside the same mutate as the write; refusals write nothing (all rounds)
- Every value reaching innerHTML is a checked integer or escaped (iterations 2-8)
- Both CLIs tested together against a real board, with plain-close controls (iterations 1-8)
- The link stored once; Replaces is derived, so the two sides cannot disagree (iterations 1-8)
