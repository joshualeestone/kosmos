---
pre_challenge: true
method: challenge-loop
branch: nudge-seen-6947
diff_hash: 97364e226a34d7cd3945049d386e14b32c5113601ba23f33c7992824b517f828
validation: passed (focused: 604 files, ~7214 tests, exit 0, at 6a15376a; after the clean rebase onto main, the card's own 5 test files 35/35 and both browser-check gates; the full suite is CI's)
subdir_audit: passed (no CLAUDE.md changed)
timestamp: 2026-10-23T00:52:00Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the usage cap; round 8's two warnings were duplicates of documented misses)
**Converged:** Yes
**Total findings:** 57 (1 BLOCKER, 27 WARNINGs, 1 CONVENTION, 28 NITs)
**Fixed:** 22 | **Deferred:** 7 | **Asked (awaiting user):** 0
**Follow-up card:** #6951 (round-8 gaps, built separately)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0
- [BLOCKER] web.task-composer-768.test.js:118 - openTaskPage's lifted stand-in lacked tkMarkSeen, so the test would throw --> FIXED (35d17af0)
- [WARNING] plan / server.js - an agent with the shared board token (no agent header) could mark its nudge seen --> FIXED (35d17af0): route requires isViaScreen
- [WARNING] plan - a message arriving while the page is open was not listed as missed --> DEFERRED then listed: the page does not redraw the conversation on its timer (checked), so it is not on screen; added to the misses
- [WARNING] plan - "messages carry no author" was wrong for some said events --> FIXED (35d17af0)
- [CONVENTION] .claude/plans/ - no plan file --> FIXED (23529d1a)
- [NIT] seen route sat between the activity route and its comment --> fixed anyway; [NIT] tmp file left on a failed rename --> fixed anyway; [NIT] Math.max spread --> fixed anyway; [NIT] non-said events not compared --> listed

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the tab-return listener from iteration 1)
- [WARNING] web/index.html - returning to the tab marked a task seen without redrawing, so a message that arrived meanwhile read as seen --> FIXED (d25ac16e): redraw first, mark only after a successful draw
- [WARNING] plan - the misses list claimed the opposite for that case --> FIXED (d25ac16e)
- [NIT] header said the activity read runs on a timer --> fixed anyway; [NIT] empty task gets no viewed line --> listed; [NIT] no cleanup on delete --> listed; [NIT] order test by indexOf --> replaced by driven tests

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 (the draw-then-mark chain from iteration 2)
- [WARNING] redraws after an action did not mark, contradicting the definition --> FIXED (af20e3a4): paintTaskActivity marks after every successful draw
- [WARNING] the person replying from the composer left the line reading "before" --> FIXED (af20e3a4) by the same change
- [WARNING] the guard compared task numbers only, not the project --> FIXED (af20e3a4): tkMarkSeen(n, projectId)
- [NITs] driven openTaskPage test, CLI "." and older-board branches, Origin arm untested, cross-site Sec-Fetch-Site accepted --> older-board test added in iteration 7; others noted

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] empty-task CLI path skips the line --> DEFERRED: every task records its creation; listed in the misses
- [WARNING] offsetParent on-screen check fragile to future CSS --> FIXED (43eb87d9): getClientRects
- [WARNING] no cleanup of task-seen files on delete --> DEFERRED: tiny files; listed in the misses
- [NITs] sync-draw assumption, misses list gaps (action redraws, phone tab), 404 vs 503 --> listed; 503 fixed in iteration 7

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 1
- [WARNING] paintTaskActivity re-checked the task after awaits but not the project (an older bug the mark now leaned on) --> FIXED (d744506e)
- [WARNING] the race window was "the whole round trip", not milliseconds --> FIXED (d744506e): wording; closing it (send the newest drawn event's time) DEFERRED as one local request
- [NITs] comments narrower than the behaviour, help line, composer stand-in, surface trailer wording --> fixed (help line, comments); trailer noted in the PR

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (1 raised as a duplicate), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] seen route used .find where activity used every matching row --> FIXED (dc39d327)
- [WARNING] misses list lacked a failed record, an older board, a silent failed post --> FIXED (dc39d327)
- [WARNING] any redraw counts as seen --> duplicate of the documented choice (iteration 3)
- [NITs] comment stronger than isViaScreen's advisory headers, second stand-in, safeKey not injective --> fixed (comment, stand-in); safeKey as taskchat

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0
- [WARNING] no test for an older board that sends no field --> FIXED (34daa136): both CLIs, with a negative control
- [WARNING] an in-page dialog over the task page counts --> FIXED (34daa136): listed
- [NIT] 404 on an unreadable project list (activity says 503) --> fixed anyway; [NITs] wording "opened" vs "drew", composer stand-in, minute vs millisecond, Windows comment --> fixed where wording

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (2 raised, both duplicates of documented misses), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** - no new actionable findings. The two gaps it restated went to #6951.
- [NIT] duplicated route comment --> fixed anyway (6a15376a)

### Final Ledger (actionable findings)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.task-composer-768.test.js:118 | BRANCH | stand-in lacked tkMarkSeen | FIXED | 35d17af0 |
| 2 | 1 | WARNING | server.js seen route | BRANCH | board token alone could mark | FIXED | 35d17af0 |
| 3 | 1 | WARNING | plan | BRANCH | open-page message miss | DEFERRED | listed; #6951 |
| 4 | 1 | WARNING | plan | BRANCH | author claim | FIXED | 35d17af0 |
| 5 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan | FIXED | 23529d1a |
| 6 | 2 | WARNING | web/index.html listener | SELF | seen before redraw | FIXED | d25ac16e |
| 7 | 2 | WARNING | plan | SELF | misses claim | FIXED | d25ac16e |
| 8 | 3 | WARNING | web/index.html | SELF | action redraws did not mark | FIXED | af20e3a4 |
| 9 | 3 | WARNING | web/index.html | BRANCH | project not compared | FIXED | af20e3a4 |
| 10 | 4 | WARNING | CLIs | BRANCH | empty task no line | DEFERRED | listed |
| 11 | 4 | WARNING | web/index.html | BRANCH | offsetParent fragile | FIXED | 43eb87d9 |
| 12 | 4 | WARNING | engine/taskseen.js | BRANCH | no cleanup | DEFERRED | listed |
| 13 | 5 | WARNING | paintTaskActivity | BRANCH | project re-check | FIXED | d744506e |
| 14 | 5 | WARNING | plan | SELF | race window size | FIXED | d744506e |
| 15 | 6 | WARNING | server.js | BRANCH | .find vs every row | FIXED | dc39d327 |
| 16 | 6 | WARNING | plan | BRANCH | missing misses | FIXED | dc39d327 |
| 17 | 7 | WARNING | CLI tests | BRANCH | no older-board test | FIXED | 34daa136 |
| 18 | 7 | WARNING | plan | BRANCH | in-page dialog | FIXED | 34daa136 |
| 19 | 8 | WARNING | web/index.html | BRANCH | open-page nudge unseen (dup #3) | DEFERRED | #6951 |
| 20 | 8 | WARNING | web/index.html | BRANCH | failed post silent (dup #16) | DEFERRED | #6951 |

### NITs (non-blocking)
- cross-site Sec-Fetch-Site accepted by the existing isViaScreen (iteration 3)
- Origin arm of isViaScreen untested (iteration 3)
- minute display vs millisecond comparison (iteration 7)
- composer stand-in passes an unused tkMarkSeen (iterations 5, 7)

### Strengths
- The seen record lives in its own folder, so a view never counts as room progress, pinned by a test with a control (all iterations)
- Only the person's page can mark (isViaScreen); agent token and board-token-alone both refused and tested (iterations 1-8)
- Seen is sent only after a successful draw, for the project and task drawn, on screen in a visible tab; the tests drive the real lifted functions with held fetches (iterations 3-8)
- Mac and Windows print the same line; an older board prints nothing; both pinned with a negative control (iterations 2-8)
