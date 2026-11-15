---
pre_challenge: true
method: challenge-loop
branch: closedhow-8552
diff_hash: 980053156066592d28c19ef624fd44292cb44b321ab0c8017d87c69043ab5621
validation: passed
subdir_audit: passed
timestamp: 2026-11-15T10:49:36Z
iterations: 9
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** No. Stopped by the standing review-usage rule (Splinter 2026-10-22, restated 10-26: a loop stops at 8 rounds unless a BLOCKER is open; the last round is a separate whole-branch read with no plan file). Round 8 had no BLOCKER; round 9 was that final read. Its one actionable finding (a comment overclaim) was fixed; its WARNINGs repeat deferred ones and went to follow-up card #8555.
**Total findings:** 17 actionable (1 BLOCKER, 13 WARNINGs, 3 CONVENTIONs), plus NITs
**Fixed:** 11 | **Deferred:** 6 | **Asked (awaiting user):** 0

Final validation (6j): the first run was red (engine.reachable.test.js: childrenOf gained a caller and had to leave TRIAGED_5548; a temp-dir leak from the new test). Both were fixed in 87f41ebcc3; the rerun PASSED (29187 tests, 0 fail), hash 980053156066.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] cli.task-show-8202.test.js:134,150 — existing CLI tests red on the new plain-close words --> FIXED (dbc2707732)
- [WARNING] engine/tasks.js closedHowAt — a parent whose subtasks did the work read as unbuilt --> FIXED (dbc2707732)
- [WARNING] server.js:23457 — a note pushed after the close stayed a note --> FIXED (dbc2707732)
- [WARNING] engine/tasklist.js — CLI ignored landedCheck missing --> FIXED (dbc2707732)
- [NIT] words written twice (page and CLI)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/tasks.js — "unbuilt" reads as an accusation on honest closes --> DEFERRED: the card asks for exactly this word; the wording is factual; recorded on the card
- [WARNING] engine/tasks.js closedHowOf — stored unbuilt never upgraded --> DEFERRED: unreachable, setBuilt refuses a closed task
- [WARNING] server.js:23458 — row may be the stored object --> DEFERRED: allTasks rows are copies; the route test covers it
- [CONVENTION] web/index.html — "Done, closed with a change" redundant --> FIXED (1ed6eb5170)

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html paintTaskPage — the missing-change guard can never fire on the task page (project payload has no landedCheck); test fed a field the reader never gets --> FIXED by deleting the guard and its test arm (3558bd0793)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (task page vs row)
- [WARNING] engine/tasks.js setClosed — reopen with parts still closed keeps the word --> DEFERRED: the task is still closed then, so the word stays true

#### Iteration 5
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js — the upgrade is not stored, so after the 14-day window a pushed note reads note again --> DEFERRED to #8555: same rule as #7508's commit line on the same row
- [NIT] closedHowAt(null) arm unreachable --> FIXED (c537f2e810)
- [NIT] second copy of the parent rule --> FIXED, uses childrenOf (c537f2e810)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (unbuilt wording)
- [WARNING] web/index.html — multi-part closed page untested --> FIXED (989c1a976d)

#### Iteration 7
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (task page vs row)
- [WARNING] engine/tasks.js — a subtask put under a task after it closed unbuilt kept the word --> FIXED on both reads (17e96051fc)
- [NIT] no test for the parent-cascade close --> FIXED (17e96051fc)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 2 (unbuilt wording; task page vs row)
- [WARNING] server.js:23458 — recompute without hasSubtasks can upgrade any row --> DEFERRED: a row without a landed commit is never checked, and a parent's own pushed commit is a real change

#### Iteration 9 (final whole-branch read, no plan file)
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 new WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above
**Duplicates of prior findings:** 2 (reader difference, both halves; on #8555)
- [CONVENTION] engine/tasks.js:914 — comment implied the word was verified rather than reported at mark time --> FIXED by cutting the claim (becc81db01)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | cli.task-show-8202.test.js:150 | BRANCH | existing CLI tests red | FIXED | dbc2707732 |
| 2 | 1 | WARNING | engine/tasks.js closedHowAt | BRANCH | parent read as unbuilt | FIXED | dbc2707732 |
| 3 | 1 | WARNING | server.js:23457 | BRANCH | later push not upgraded | FIXED | dbc2707732 |
| 4 | 1 | WARNING | engine/tasklist.js | BRANCH | CLI ignored missing | FIXED | dbc2707732 |
| 5 | 2 | WARNING | engine/tasks.js | BRANCH | unbuilt wording | DEFERRED | card asks for it |
| 6 | 2 | WARNING | engine/tasks.js closedHowOf | BRANCH | unbuilt never upgraded | DEFERRED | unreachable |
| 7 | 2 | WARNING | server.js:23458 | SELF | row may be stored object | DEFERRED | rows are copies |
| 8 | 2 | CONVENTION | web/index.html | BRANCH | redundant wording | FIXED | 1ed6eb5170 |
| 9 | 3 | WARNING | web/index.html paintTaskPage | SELF | dead guard, fake fixture | FIXED | 3558bd0793 |
| 10 | 4 | WARNING | engine/tasks.js setClosed | BRANCH | reopen with parts closed | DEFERRED | still closed |
| 11 | 5 | WARNING | server.js | SELF | upgrade not stored | DEFERRED | #8555 |
| 12 | 5 | NIT | engine/tasks.js | SELF | null arm | FIXED | c537f2e810 |
| 13 | 5 | NIT | engine/tasks.js | SELF | parent rule copy | FIXED | c537f2e810 |
| 14 | 6 | WARNING | web/index.html | BRANCH | multi-part untested | FIXED | 989c1a976d |
| 15 | 7 | WARNING | engine/tasks.js | BRANCH | subtask added after close | FIXED | 17e96051fc |
| 16 | 8 | WARNING | server.js:23458 | SELF | recompute is loose | DEFERRED | unreachable harm |
| 17 | 9 | CONVENTION | engine/tasks.js:914 | SELF | comment overclaim | FIXED | becc81db01 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- Word-to-text mapping written in two places, page and CLI (iterations 1, 2, 3)
- typeof guards exist for lifted-function tests (iterations 1, 8)
- Windows CLI list line shows [done] without the word (iteration 2)
- Stored word on replaced and not-run closes is hidden but kept (iteration 3)
- landedCheck missing hides a fingerprint-based change too (iteration 9)

### Strengths (across all iterations)
- The word is derived once, in the engine, before the built mark is dropped, on both close paths (all iterations)
- Every reader takes the engine word; none re-derives it (iterations 2, 5)
- Tests carry controls on every arm, including a real git push on the route (iterations 3, 7)
- Mutants on every changed site were red before review started
