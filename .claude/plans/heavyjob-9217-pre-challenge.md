---
pre_challenge: true
method: challenge-loop
branch: heavyjob-9217
diff_hash: f445ed9a1321caba5c064daa5a9c99837ea6a34feaca5c71b757ae07ee887cbb
validation: passed
subdir_audit: passed
timestamp: 2026-11-27T18:31:39Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 by Splinter's standing usage rule (Fleet Builders m510, 2026-10-26: a
review loop stops at 8 rounds unless a BLOCKER is open; past 8, WARNINGs go to a follow-up card). No BLOCKER was open.
Round 8's one new WARNING is kosmos#9222.
**Total findings:** 33 actionable (3 BLOCKERs, 2 found by reviewers and 1 by me while fixing; 27 WARNINGs, 2 of them duplicates; 3 CONVENTIONs) and 31 NITs
**Fixed:** 28 | **Deferred:** 5 (2 duplicates, 1 to follow-up #9222, 1 not a defect, 1 judged on reading) | **Asked:** 0

6.0 baseline validation was queued at 10:06 and stopped before its turn, because round 1 found a BLOCKER (the Windows
CLI parity test) that it would have failed on. The closing validation ran on the final head (see the front matter).
The branch was rebased onto origin/main 205a65a8c9 after round 8 (#9219 touched four of these files): the loop shas
below are pre-rebase.

**Closing validation (6j).** Validation of 4fc299fb08 failed 3 of 31801, all whole-repo guards (a raw writeFileSync,
hand-built roster rows in a test, and "agent ... on this computer" in a page comment). They were recorded as synthetic
BLOCKERs (Origin BRANCH) and fixed in 75f75585e4. A second full validation of 75f75585e4 passed: 31801 tests, 0
failures, rc 0, audit rc 0, clean tree. The branch was then rebased onto origin/main 1639cc0ad8, because #9218 added a
verb to the same two CLI files. The overlap tests on the merged tree passed (142/142: CLI parity, help lines, the
Windows runner guard, fixture-discipline, empty-scope, every heavy test) and the surface gate was 0. The PR's CI runs
the full suite on the merged tree.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 7 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 (ITER_COMMITS was empty)
- [BLOCKER] install/kosmos:9692 - heavy verb missing from the Windows CLI and the banner; parity test reds --> FIXED (37027b6b4a)
- [WARNING] install/kosmos:3946 - kosmos heavy --help unreachable behind the global guard --> FIXED (37027b6b4a)
- [WARNING] server.js:3376 - one missed poll or a partial snapshot deletes a record --> FIXED (37027b6b4a)
- [WARNING] engine/heavyjobs.js:88 - one ps per record per poll --> FIXED (37027b6b4a)
- [WARNING] engine/heavyjobs.js:144 - writeAll throws, leaks a path, hides jobs --> FIXED (37027b6b4a)
- [WARNING] web/index.html:25354 - note shows the session name --> FIXED (37027b6b4a)
- [WARNING] server.js:28325 - GET /api/heavy lacks cross-site and sibling refusal --> FIXED (37027b6b4a)
- [WARNING] engine/heavyjobs.js:96 - on Windows a pid record never clears --> FIXED (37027b6b4a)
- [NIT] five, all FIXED (37027b6b4a)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above (engine/heavyjobs.js:141, code, fixed normally)
- [WARNING] server.heavy-9217.test.js:84 - exited-process test never checks an exit --> FIXED (f17ed7bc5e)
- [WARNING] engine/heavyjobs.js:141 - cap counts dead records --> FIXED (f17ed7bc5e)
- [WARNING] server.js:3398 - every agent stopped: grace never starts --> FIXED (f17ed7bc5e)
- [WARNING] server.js:3399 - a missing mark outlives its job --> FIXED (f17ed7bc5e)
- [CONVENTION] .claude/plans - plan exists and matches --> DEFERRED: not a defect
- [NIT] three FIXED, one DEFERRED (viewer-local time is right for a person)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 3 NITs (plus 1 BLOCKER found by me: windows-tests-1777 guard)
**Self-generated:** 1 of the above (engine/heavyjobs.js:113, code, fixed normally)
- [WARNING] engine/heavyjobs.js:37 - a label can spell a Kosmos marker or carry bidi marks --> FIXED (ea514825cf)
- [WARNING] engine/heavyjobs.js:113 - ps on the hot route --> FIXED (ea514825cf)
- [WARNING] engine/heavyjobs.js:134 - start stores a cached start --> FIXED (ea514825cf)
- [WARNING] tools/windows/kosmos-cli.js:2797 - Windows verb untested --> FIXED (ea514825cf)
- [WARNING] server.js:28347 - a pane named in the body is taken as given, unstated --> FIXED (ea514825cf, documented)
- [CONVENTION] cli.heavy-9217.test.js:6 - stale header --> FIXED (ea514825cf)
- [BLOCKER] tools/windows-tests.js - two new files branch on win32, unlisted --> FIXED (ea514825cf)
- [NIT] three FIXED (ea514825cf)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/heavyjobs.js:50 - pid above 2^31-1 reads alive on Windows --> FIXED (aabef51519)
- [CONVENTION] server.js:3378 - shared module state across tests --> DEFERRED: each grace arm has its own clock offset and marks are pruned with their job
- [NIT] one FIXED, two DEFERRED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (engine/heavyjobs.js:126, code, fixed normally)
- [BLOCKER] engine/heavyjobs-9217.test.js:1 - no tmpscope require; the #9104 guard reds the suite --> FIXED (efe16233f6)
- [WARNING] engine/heavyjobs.js:103 - a live pid record cleared when its agent is away --> FIXED (efe16233f6)
- [WARNING] server.js:28344 - GET names are session names; CLI display-name tests were stubbed --> FIXED (efe16233f6)
- [WARNING] web/index.html:25357 - the note uses the attention red --> FIXED (efe16233f6)
- [WARNING] engine/heavyjobs.js:126 - eight sync ps could stall for 40 s --> FIXED (efe16233f6)
- [NIT] three FIXED, one DEFERRED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (engine/heavyjobs.js:171 and :116, code, fixed normally)
**Duplicates of prior findings:** 1 (shared module state, #22)
- [WARNING] engine/heavyjobs.js:171 - one hung ps blocks for 5 s --> FIXED (9f0371f270)
- [WARNING] engine/heavyjobs.js:116 - the ceiling counted from the kept "since" --> FIXED (9f0371f270)
- [NIT] one FIXED, two DEFERRED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (server.js:3390, code, fixed normally)
- [WARNING] server.js:3390 - a read that is not complete applies an old mark to a running agent --> FIXED (4cdd1d72d6)
- [NIT] three FIXED, two DEFERRED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (pane taken as given, #18)
- [WARNING] engine/heavyjobs.js:29 - a --pid job drops at 12 h while its process is confirmed running --> DEFERRED to kosmos#9222 (usage rule)
- [NIT] four DEFERRED
**Stopped** - the usage rule's cap, with no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | install/kosmos:9692 | BRANCH | Windows CLI and banner lack heavy | FIXED | 37027b6b4a |
| 2 | 1 | WARNING | install/kosmos:3946 | BRANCH | --help unreachable | FIXED | 37027b6b4a |
| 3 | 1 | WARNING | server.js:3376 | BRANCH | one missed poll deletes a record | FIXED | 37027b6b4a |
| 4 | 1 | WARNING | engine/heavyjobs.js:88 | BRANCH | ps per record per poll | FIXED | 37027b6b4a |
| 5 | 1 | WARNING | engine/heavyjobs.js:144 | BRANCH | writeAll throws | FIXED | 37027b6b4a |
| 6 | 1 | WARNING | web/index.html:25354 | BRANCH | session name on the note | FIXED | 37027b6b4a |
| 7 | 1 | WARNING | server.js:28325 | BRANCH | GET lacks refusal | FIXED | 37027b6b4a |
| 8 | 1 | WARNING | engine/heavyjobs.js:96 | BRANCH | Windows pid never clears | FIXED | 37027b6b4a |
| 9 | 2 | WARNING | server.heavy-9217.test.js:84 | BRANCH | exit never checked | FIXED | f17ed7bc5e |
| 10 | 2 | WARNING | engine/heavyjobs.js:141 | SELF | cap counts dead records | FIXED | f17ed7bc5e |
| 11 | 2 | WARNING | server.js:3398 | BRANCH | all stopped: no grace | FIXED | f17ed7bc5e |
| 12 | 2 | WARNING | server.js:3399 | BRANCH | mark outlives job | FIXED | f17ed7bc5e |
| 13 | 2 | CONVENTION | .claude/plans | BRANCH | plan exists | DEFERRED | not a defect |
| 14 | 3 | WARNING | engine/heavyjobs.js:37 | BRANCH | label can spell a marker | FIXED | ea514825cf |
| 15 | 3 | WARNING | engine/heavyjobs.js:113 | SELF | ps on the hot route | FIXED | ea514825cf |
| 16 | 3 | WARNING | engine/heavyjobs.js:134 | BRANCH | cached start stored | FIXED | ea514825cf |
| 17 | 3 | WARNING | tools/windows/kosmos-cli.js:2797 | BRANCH | Windows verb untested | FIXED | ea514825cf |
| 18 | 3 | WARNING | server.js:28347 | BRANCH | pane taken as given, unstated | FIXED | ea514825cf |
| 19 | 3 | CONVENTION | cli.heavy-9217.test.js:6 | BRANCH | stale header | FIXED | ea514825cf |
| 20 | 3 | BLOCKER | tools/windows-tests.js | BRANCH | win32 guard red | FIXED | ea514825cf |
| 21 | 4 | WARNING | engine/heavyjobs.js:50 | BRANCH | pid above 2^31-1 | FIXED | aabef51519 |
| 22 | 4 | CONVENTION | server.js:3378 | BRANCH | shared state in tests | DEFERRED | own clock offsets; marks pruned |
| 23 | 5 | BLOCKER | engine/heavyjobs-9217.test.js:1 | BRANCH | no tmpscope | FIXED | efe16233f6 |
| 24 | 5 | WARNING | engine/heavyjobs.js:103 | BRANCH | live pid cleared with agent | FIXED | efe16233f6 |
| 25 | 5 | WARNING | server.js:28344 | BRANCH | GET names; stubbed tests | FIXED | efe16233f6 |
| 26 | 5 | WARNING | web/index.html:25357 | BRANCH | attention red | FIXED | efe16233f6 |
| 27 | 5 | WARNING | engine/heavyjobs.js:126 | SELF | 40 s stall | FIXED | efe16233f6 |
| 28 | 6 | WARNING | engine/heavyjobs.js:171 | SELF | hung ps 5 s | FIXED | 9f0371f270 |
| 29 | 6 | WARNING | engine/heavyjobs.js:116 | SELF | ceiling from since | FIXED | 9f0371f270 |
| 30 | 7 | WARNING | server.js:3390 | SELF | old mark on a running agent | FIXED | 4cdd1d72d6 |
| 31 | 8 | WARNING | engine/heavyjobs.js:29 | BRANCH | 12 h ceiling on a confirmed process | DEFERRED | kosmos#9222 |
| 32 | 6 | WARNING | server.js:3382 | BRANCH | shared state (dup of 22) | DEFERRED | as 22 |
| 33 | 8 | WARNING | server.js:28359 | BRANCH | pane as given (dup of 18) | DEFERRED | as 18 |

Every FIXED code finding has a test arm that was mutated to red (37 mutations across the eight rounds; four arms
survived their first mutation, were strengthened or re-aimed, and then went red).

### NITs (non-blocking, across all iterations)
- 31 NITs: 19 FIXED with their round's commit, 12 DEFERRED with reasons in D/ledger-heavyjob-9217.md (for example: stdout
  versus stderr matches the Mac CLI's convention; EPERM pids are bounded by the ceiling; the leading "-" refusal keeps a
  label from reading as an option).

### Strengths (across all iterations)
- The note is built from text nodes only, pinned both by the page test and by the real-board browser check (iteration 1).
- Every guard has a control that can fail, including a nothing-running board (iterations 1, 5).
- A reused pid is told apart by its start time, and a new record's start is always read fresh (iterations 3, 7).
- Both CLIs match in usage, parsing, bodies and messages, each with its own test (iterations 4, 8).
