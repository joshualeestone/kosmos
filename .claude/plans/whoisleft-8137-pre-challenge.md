---
pre_challenge: true
method: challenge-loop
branch: whoisleft-8137
diff_hash: b5ab2bd9d14b03b77a95627c7d5d89569a15cc947bd8b2af98d43db627e686d0
validation: failed on one file, then passed it alone; not rerun whole on the final code. Full run on 1127fd57f7: node suite 27254 pass, 0 fail; test:shell red on tools/test-queued-heavy-4977.sh only (141 of 142, with other queue work on the Mac), which passes alone, and 13 later commands in that shard did not run. Since then, focused: 249 files on 548fe36b84, 6451 pass, 0 fail; 50 reader and guard files on c0744a2518 (the squash and rebase), 834 pass, 0 fail; iPhone suites 151 and 115 pass; render-tasks passes in Chromium, before the squash. CI is the full run on the final code.
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-07T00:26:19Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes. Round 7 raised no BLOCKER, WARNING or CONVENTION. Not reviewed after that: the squash and rebase onto #8140, which needed one conflict resolved by hand on the long `task list` line of install/kosmos (my snippet put into main's version of that line).
**Total findings:** 4 BLOCKERs, 18 WARNINGs, 3 CONVENTIONs, about 30 NITs
**Fixed:** 4 BLOCKERs, 11 WARNINGs | **Deferred:** 7 WARNINGs, 3 CONVENTIONs | **Asked (awaiting user):** 0

**Self-generated lines below:** not measured; the blame lookup was not run, so no counts are given.

**Commits.** Squashed into one for the rebase, since several commits edited the one conflicting line. The rounds' commits are not in the final history; the local branch whoisleft-8137-backup held them until merge.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] engine/tasks.js: a held task shows the line though hasOpenWork says free --> DEFERRED: the part really is open, the row says it is on hold, and the test now pins this; the agreement test's title narrowed to live tasks
- [WARNING] same for a paused project --> DEFERRED, same reason
- [WARNING] engine/agentnudge.js: alsoLeft ignores hold and pause --> DEFERRED: the nudge skips those tasks first; a test pins it
- [WARNING] server.js: a name with a backslash or control character reaches the CLI's sed --> FIXED, stripped
- [CONVENTION] plan states no one has seen it on a phone --> DEFERRED: true and said on the card
- [NIT] "Your part only: Still to finish" --> FIXED. [NIT] two others accepted.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
- [BLOCKER] server.js: `kosmos task built` never named who was left on a real board: projects.get() holds member objects, so everyone was filtered out, and the CLI test's stub supplied the sentence --> FIXED, and server.whoisleft-8137.test.js holds it through the real route
- [BLOCKER] docs/browser-checks/render-tasks.js: the new arm clicked a tab that stays hidden under 25 tasks --> FIXED
- [WARNING] CLI tests' stub supplied the premise --> FIXED, the real route test
- [WARNING] the task page's read had no running test --> FIXED
- [WARNING] an unnamed mark or a checker told "Your part only" --> FIXED, only a named marker holding a part
- [WARNING] plan stated output not actually seen --> FIXED
- [NIT] "Finished: rex, amy." with a part nobody holds --> FIXED, no line. Others fixed or noted.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] an empty or missing member list behaves differently by path --> DEFERRED: fails safe, no line, and a real project has a list
- [WARNING] a departed marker sees a list without itself --> DEFERRED: matches what the board shows

#### Iteration 4
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [BLOCKER] web/index.html tskRow: tests that lift a page function by name would throw on the new helper --> FIXED, typeof guard, as the page does elsewhere
- [BLOCKER] web/index.html paintTaskPage: same --> FIXED
- [WARNING] iOS row: the two-line limit could cut the line off --> FIXED, its own Text with no limit; VoiceOver still reads it
- [WARNING] nothing tested the line reaching the row --> FIXED
- [NIT] x3 two tests that could not fail, and --all untested --> FIXED

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] builtFreesAll without the person flag --> DEFERRED: the code reads only builtFreesAll
- [WARNING] a Unicode line separator in a name reaches a CLI line --> DEFERRED: display only, and agent names are constrained
- [CONVENTION] compact list's line could be imitated by a task's words --> DEFERRED: stated in the plan; the long list uses its own line

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] the project column had no line, and it is the list most people see --> FIXED, with a browser arm and a control
- [WARNING] "0 of 2 parts done" sat beside "Finished: rex" --> FIXED, the words are now "Reported finished"
- [WARNING] server.builttell-6330.test.js could pass on the new sentence alone --> FIXED, both sentences required
- [NIT] the task page's read drops a departed agent, untested --> FIXED. Others accepted.

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** on 548fe36b84.

### Measured
- The rule against assigner.hasOpenWork on six live shapes, both arms.
- The real routes: the built answer, /api/tasks and /api/projects, with controls.
- Both CLIs; the bash one against a stub board, the Windows one through its main, not on Windows.
- In Chromium on a real sandbox board: project column, Tasks view and task page, each with a one-agent control. Read by me from screenshots.
- iPhone logic suites; every app source typechecks for the simulator.

### Not measured
- A person reading it on a real task, and whether "Reported finished" reads as meant.
- The iPhone screens running: logic and typecheck only.
- The marked-built path on the rendered board: the browser arm closes a part; the mark is tested at the route.

### Disclosed
- A test run I took as clean was missing 212 files: its list named a deleted worktree, and node exits 0 on a path that matches nothing. Caught from the output, rerun with 249 files present.
- Two commands chained after a deciding result, again, one after the failed rebase; those numbers were discarded.

### Strengths
- One server rule, no client works it out; a test holds it to the nudge's rule.
- A task's words cannot print the long list's line; names are escaped on every surface.
