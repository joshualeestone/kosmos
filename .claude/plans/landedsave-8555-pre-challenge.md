---
pre_challenge: true
method: challenge-loop
branch: landedsave-8555
diff_hash: 3712194a2a90ef6244901a63ae4fdbc87f722737e1a6e989a3ecbf71de30fd10
validation: passed
subdir_audit: passed
timestamp: 2026-11-15T12:16:39Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (the 6.0 initial-validation pass plus five blind reviews)
**Converged:** Yes, at iteration 6 (no new BLOCKER, WARNING or CONVENTION after deduplication; no ASKED findings)
**Total findings:** 9 (1 BLOCKER, 8 WARNINGs, 0 CONVENTIONs, 19 NITs)
**Fixed:** 5 | **Deferred:** 2 | **Duplicates confirmed resolved or deferred:** 2 | **Asked (awaiting user):** 0
**Final validation (6j):** passed on 573ec69601, 29217 tests, 0 fail, build passed, hash 3712194a2a90

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** none (validation helper)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (6.0's synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: the browser-check gate (#1720) refused the web/ change with no browser-check assertion or trailer --> FIXED (4fda7df, a Browser-check trailer: one condition on the task page's closed-how word, asserted by web.task-page.test.js)

#### Iteration 2
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/projects.js:803 — the cached landedCheck reaches /api/tasks rows too --> DEFERRED: /api/tasks takes only `.claim` from joinTaskClaims and builds its rows from allTasks (server.js:23380-23386), so the field never reaches a Tasks row
- [WARNING] engine/tasks.js saveOnRemote — compares the sha but not the repository, unlike setBuilt's keep rule --> FIXED (3b5e8e4: repo argument and guard, a different-repo control and a no-repo refusal; a mutant without the guard turns the test red)
- [NIT] server.js — `!c` in `if (!c || sent)` could never be true --> fixed in 3b5e8e4
- [NIT] engine/projects.js — comment said the page always agrees with the row --> fixed in 3b5e8e4
- [NIT] web/index.html — a missing commit also drops a file-based closed-how word (as the Tasks row does)
- [NIT] engine/landedcheck.js — cachedFor repeats checkTask's key and TTL expression

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured (blame was not run for this finding; it is a code finding, fixed normally either way)
- [WARNING] engine/projects.js:803 — progressOf runs a second time per task on a hot synchronous path --> FIXED (9fe5b01: the cache lookup runs first, so a task with no cached answer does no other work)
- [NIT] engine/projects.js — the window test is repeated in the route and the payload
- [NIT] engine/landedsave-8555.test.js:57 — assertion message read as its opposite --> fixed in 9fe5b01
- [NIT] engine/tasks.js — NO_WRITE pattern noted as consistent
- [NIT] server.js — open tasks are saved too (intended)

#### Iteration 4
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
**Duplicates of prior findings:** 1 (the /api/tasks rows concern, deferred in iteration 2)
- [WARNING] server.js:23461 — a refused save was dropped, so a broken store looked like a working one --> FIXED (723ad5b: logged once per task)
- [NIT] engine/projects.js — progressOf twice (seen before the reorder)
- [NIT] web/index.html — file-based change and missing commit (as iteration 2)
- [NIT] engine/tasks.js — "written once" should say once per commit --> fixed in 723ad5b

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [WARNING] web/index.html:73396 — the comment said the word never stands beside a missing change, but the page has the answer only while the cache does --> FIXED (23da732: the comment says it is the cached answer, held only while the cache has one)
- [WARNING] server.js:23468 — does anything sort or report projects by updatedAt? --> DEFERRED: `git grep updatedAt` finds 3 mentions in engine/projects.js (writers), 0 in server.js, and 1 in web/index.html, a comment saying updatedAt is deliberately not used
- [NIT] server.js — landedSaveFailed never drops a key
- [NIT] engine/tasks.js — COMMIT_SHA_RE is declared after saveOnRemote (works at call time)
- [NIT] engine/tasks.js — landedOnRemoteNow is null when there is no commit (read only when there is one)
- [NIT] engine/projects.js — the inline IIFE could be a named helper

#### Iteration 6
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (the task page's cache-dependence: the iteration-5 comment fix states it, and the plan records it as a known limit)
- [NIT] web/index.html — file-based change and missing commit (as iterations 2 and 4)
- [NIT] server.js — landedSaveFailed and the log line's wording
- [NIT] .claude/plans/landedsave-8555.md — saveOnRemote's signature lacked the repo --> fixed in 573ec69 (plan only)
- [NIT] server.builtcommit-7508.test.js — updatedAt compares to the millisecond (the engine test checks the same property directly)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | initial-validation | BRANCH | browser-check gate wanted a reason for the web/ change | FIXED | 4fda7df |
| 2 | 2 | WARNING | engine/projects.js:803 | BRANCH | cached landedCheck reaches /api/tasks rows | DEFERRED | the route takes only .claim from the join |
| 3 | 2 | WARNING | engine/tasks.js saveOnRemote | BRANCH | no repository guard | FIXED | 3b5e8e4 |
| 4 | 3 | WARNING | engine/projects.js:803 | BRANCH | progressOf twice on a hot path | FIXED | 9fe5b01 |
| 5 | 4 | WARNING | server.js:23461 | BRANCH | refused save dropped silently | FIXED | 723ad5b |
| 6 | 5 | WARNING | web/index.html:73396 | BRANCH | comment overstated the page's guarantee | FIXED | 23da732 |
| 7 | 5 | WARNING | server.js:23468 | BRANCH | other readers of project updatedAt | DEFERRED | git grep: none read it |

Origin is BRANCH throughout: provenance was not looked up by blame in this run, and BRANCH is the field's fail-safe value.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Strengths (across all iterations)
- saveOnRemote is upgrade-only, keyed on sha and repository, writes nothing when the task already says so, and never throws; each guard has an assertion with a control (iterations 2-6)
- The route keeps landedRepo on the row the closure holds, because sendRows swaps in a copy before deleting it, so a save after the 1.5 s send is real (iterations 4 and 6)
- The route test uses real repositories and a bare remote, with a pre-push control and a past-the-window arm (iterations 2-6)
- Mutants: no save, re-mark downgrade, no sha guard, no repo guard, no page check, window ignored, page guard removed, route save removed: each turned a test red
