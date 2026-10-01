---
pre_challenge: true
method: challenge-loop
branch: taskwho-4887
diff_hash: 9fe8855bb3fc9df55a30d5207ffe22175890b55a73d34f512bc5037b286e0e10
validation: passed
subdir_audit: passed
timestamp: 2026-10-01T21:39:05Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14
**Converged:** Yes
**Total findings:** 25 actionable (0 BLOCKERs, 24 WARNINGs, 1 CONVENTION) plus NITs
**Fixed:** 19 | **Deferred:** 6 | **Asked (awaiting user):** 0

Final validation: full suite at c55fa35f3, 13814 tests, 0 failed, validation_rc=0, audit_rc=0 (hash 9fe8855bb3fc).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] install/kosmos:3335 — Mac read of "who" from the answer stopped at the first }, so a title with a brace dropped ", for <agent>" --> FIXED (339ca6348)
- [WARNING] cli.task-who-4887.test.js — no test of --who me from an identified caller through either CLI --> FIXED (339ca6348)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js — --who me paged the caller's own screen and spent its own hourly allowance --> FIXED (bd86f8ca5)
- [WARNING] install/kosmos, kosmos-cli.js — usage line did not mention `me` --> FIXED (bd86f8ca5)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/projects.js — the managed instructions block did not teach --who --> FIXED (2a64e8888)
- [WARNING] install/kosmos, kosmos-cli.js — [added by] compared case-sensitively --> FIXED (2a64e8888)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.task-who-4887.test.js — server test stubs tasks.create, so the real engine path is untested --> DEFERRED: the CLI test runs the real board, engine and store (--who Otto lands on otto; --who zed gets the engine's refusal)
- [WARNING] server.js — self-given task's answer has no `heard` --> DEFERRED: undefined already means nobody to tell (an unassigned task's answer has none); no CLI reads it; recorded in the plan
- [CONVENTION] plan — decided list split by a blank line --> FIXED (8ed08d523, 1f4484c38)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING (+1 duplicate of iteration 4's heard), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] install/kosmos, kosmos-cli.js — [added by] missed store-key forms (Mona Lisa vs monalisa) --> FIXED (82b016de7)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] install/kosmos:3290 — list comment claimed parity with Windows, mis-indented --> FIXED by deleting the claim (04d4418fa)
- [WARNING] install/kosmos:3335 — Mac read depends on field order nobody pinned --> FIXED: test pins the answer's order (04d4418fa)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js — `me` alias applied to the page, so a person's agent named Me could not be given a task there --> FIXED (01af83dd2)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] install/kosmos — a detail word `--who` is taken as the flag --> DEFERRED: same as --parent; the plan takes the flag out wherever it sits
- [WARNING] install/kosmos — control bytes in a name broke the request --> FIXED (1e582ca9a)
- [WARNING] server.js — member read before the store lock --> DEFERRED: tasks.create re-checks membership inside its mutate; worst case is a refusal

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/projects.js — instructions line claimed an unowned task goes to whoever is free --> FIXED by deleting the claim (028bbc3b3)
- [WARNING] server.task-who-4887.test.js — no paneless (key-matched) caller test --> FIXED (028bbc3b3)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (+1 duplicate of iteration 4's heard), 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] server.js — comment on the member read's catch over-claimed --> FIXED by deleting the comment (89bbaacc1)

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] install/kosmos — a name of only control bytes passed the blank check and was sent as "who":"" (no owner, no word) --> FIXED on both CLIs (513e22a81)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] server.js — comment clause held only for string names --> FIXED by deleting the clause (622c75ce4)
- [WARNING] server.js — an unidentified caller's `me` is now a 400 --> DEFERRED: stated in the plan and tested

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js — a given who of only spaces (U+00A0) stored as no owner, answered as success --> FIXED: board refuses it (c55fa35f3)
- [WARNING] server.task-who-4887.test.js — ambiguity guard (found.length === 1) untested --> FIXED (c55fa35f3)
- [CONVENTION] plan file name lacked the date --> FIXED: renamed to taskwho-4887-2026-10-01.md (c55fa35f3)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/kosmos:3335 | BRANCH | brace in title broke Mac who read | FIXED | 339ca6348 |
| 2 | 1 | WARNING | cli.task-who-4887.test.js | BRANCH | no identified --who me test | FIXED | 339ca6348 |
| 3 | 2 | WARNING | server.js | BRANCH | self-page on --who me | FIXED | bd86f8ca5 |
| 4 | 2 | WARNING | install/kosmos, kosmos-cli.js | BRANCH | usage line lacked me | FIXED | bd86f8ca5 |
| 5 | 3 | WARNING | engine/projects.js | BRANCH | instructions did not teach --who | FIXED | 2a64e8888 |
| 6 | 3 | WARNING | CLIs list | BRANCH | added-by case-sensitive | FIXED | 2a64e8888 |
| 7 | 4 | WARNING | server.task-who-4887.test.js | BRANCH | engine path stubbed | DEFERRED | covered by real-engine CLI test |
| 8 | 4 | WARNING | server.js | BRANCH | no heard for self-given task | DEFERRED | undefined = nobody to tell; plan |
| 9 | 4 | CONVENTION | plan | BRANCH | decided list grouping | FIXED | 8ed08d523 |
| 10 | 5 | WARNING | CLIs list | BRANCH | added-by missed store-key forms | FIXED | 82b016de7 |
| 11 | 6 | WARNING | install/kosmos:3290 | SELF | comment parity claim | FIXED | 04d4418fa |
| 12 | 6 | WARNING | install/kosmos:3335 | BRANCH | field order unpinned | FIXED | 04d4418fa |
| 13 | 7 | WARNING | server.js | BRANCH | me alias on the page | FIXED | 01af83dd2 |
| 14 | 8 | WARNING | install/kosmos | BRANCH | --who in detail taken as flag | DEFERRED | mirrors --parent |
| 15 | 8 | WARNING | install/kosmos | BRANCH | control bytes broke request | FIXED | 1e582ca9a |
| 16 | 8 | WARNING | server.js | BRANCH | members read before lock | DEFERRED | engine re-checks in mutate |
| 17 | 9 | WARNING | engine/projects.js | SELF | instructions over-claim | FIXED | 028bbc3b3 |
| 18 | 9 | WARNING | server.task-who-4887.test.js | BRANCH | no paneless test | FIXED | 028bbc3b3 |
| 19 | 10 | WARNING | server.js | SELF | catch comment over-claim | FIXED | 89bbaacc1 |
| 20 | 11 | WARNING | install/kosmos | SELF | control-only name sent as "" | FIXED | 513e22a81 |
| 21 | 12 | WARNING | server.js | SELF | comment clause strings only | FIXED | 622c75ce4 |
| 22 | 12 | WARNING | server.js | BRANCH | unidentified me now 400 | DEFERRED | in plan, tested |
| 23 | 13 | WARNING | server.js | BRANCH | blank (U+00A0) who stored as no owner | FIXED | c55fa35f3 |
| 24 | 13 | WARNING | server.task-who-4887.test.js | BRANCH | ambiguity guard untested | FIXED | c55fa35f3 |
| 25 | 13 | CONVENTION | plan | BRANCH | plan name lacked date | FIXED | c55fa35f3 |

### NITs (non-blocking, across all iterations)
- An agent literally named "me" is reached by the page always; from an agent, only by its exact spelling (iterations 1, 3, 4, 7; plan records it)
- Two members sharing a store key get "not on this project" rather than "ambiguous" (iterations 1, 2, 7, 13)
- A project id of `--who` / `--parent` is not refused before the board (iterations 3, 9, 13, 14; inherited from --parent)
- Windows prints the stored who as received; Mac drops a name with a backslash (iterations 10, 11, 14)
- projects.readAll is read a second time on this route (iterations 3, 12, 14)
- The managed-block line costs one line per project (iterations 4, 5, 12)

### Strengths (across all iterations)
- `me` is resolved on the board from the caller's real identity, never in a CLI; membership stays enforced inside tasks.create's atomic mutate
- Mac and Windows CLIs refuse the same bad forms with the same words and exit codes, tested against a real board and engine
- Every new test was run against the previous code and failed there before it was kept
