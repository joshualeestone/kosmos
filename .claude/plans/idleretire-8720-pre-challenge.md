---
pre_challenge: true
method: challenge-loop
branch: idleretire-8720
diff_hash: b83e5aa481a50bfa05fd84dde70641d315bc72cae18893872168d8c8bdbd0341
validation: passed (Mortals, 31759 tests, 0 failed, entry clean b83e5aa481a5)
subdir_audit: passed
timestamp: 2026-11-27T20:16:18Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 by Splinter's standing review-usage rule ("A review loop stops at 8 rounds unless a BLOCKER is still open", 2026-10-22, restated in Fleet Builders m510 on 2026-10-26). No BLOCKER was open. Round 8 found 1 WARNING and 1 CONVENTION, both fixed in 8e869fc26a after the last round. Those two edits were not reviewed by a further round. The residuals are on kosmos#9228.
**Total findings:** 46 (1 BLOCKER, 27 WARNINGs, 5 CONVENTIONs, 13 NITs)
**Fixed:** 39 | **Deferred:** 6 | **Asked (awaiting user):** 0
(One further NIT, the Recommender-like save-epoch pattern, was folded into round 7's in-flight save fix.)

After the loop, the full Mortals run at 8e869fc26a was red on 5 source-scanning guards: fixture-discipline, sweeproster-7693, windows-tests-1777, browser-checks-indexed, tools.browser-checks-wired. There were 0 product failures. The guards were fixed in 9c6989203a, and the full rerun passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 9 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] engine/idleretire.js assess: the row's live state was not consulted --> FIXED (833b3718cd)
- [WARNING] engine/idleretire.js realReaders.latestState: an unreadable self-report did not protect --> FIXED (833b3718cd)
- [WARNING] engine/idleretire.js: idle was calendar time, so a board that was off for a month would retire everyone --> FIXED (833b3718cd), running days
- [WARNING] server.js GET /api/idle-retire: a null roster answered 200 with empty verdicts --> FIXED (833b3718cd)
- [WARNING] web/index.html: the lists were hidden while the switch was off, so there was no preview --> FIXED (833b3718cd)
- [WARNING] server.js PUT: the advisory isViaScreen gate --> DEFERRED: it is the gate on every Settings switch, and DELETE /api/agent has the same gate for a no-token caller; recorded in the plan
- [WARNING] engine/idleretire.js makeTick: non-ours rows were retried and re-logged every day --> FIXED (833b3718cd)
- [WARNING] tests: no coverage of the dry-run mapping, the real readers or the unreadable path --> FIXED (833b3718cd)
- [WARNING] engine/idleretire.js makeTick: synchronous removals all ran in one tick --> FIXED (833b3718cd), at most 3 per tick
- [CONVENTION] server.js: the comment named the wrong Settings tab --> FIXED (833b3718cd)
- [CONVENTION] engine/idleretire.js: a hand copy of WAITING_ON_A_PERSON --> FIXED (833b3718cd)
- [NIT] render-prompter-label-1843 label; "a project" fallback --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] server.js safeRoster rows carry no isGuide, so the setup guide was retirable on the live path --> FIXED (262b072b59), idleRetireRows with a route test through a real roster row (red with the marking removed)
- [WARNING] PUT isViaScreen --> DEFERRED (duplicate of iteration 1, same reasoning)
- [WARNING] makeTick: a failed final write was silent --> FIXED (262b072b59)
- [NIT] "(unnamed)" project; "partly removed" wording --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/idleretire.js: shownAs read displayName, which real rows do not carry, so the lists showed machine names --> FIXED (8cc8da9e5b), route test red on the old read
- [NIT] a throw from remove() was recorded as refused --> FIXED, now partial; "next check" wording --> FIXED; the preview counted today one tick late --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] no re-read between judging and removing --> DEFERRED: the tick is synchronous and liveness is written only by this process; recorded in the plan
- [WARNING] refused and partial removals were retried daily forever --> FIXED (becce4ec3c), weekly back-off
- [WARNING] a damaged log was overwritten --> FIXED (becce4ec3c), renamed aside
- [WARNING] the copy named the wrong control --> FIXED (becce4ec3c)
- [NIT] HEAD body --> DEFERRED (sibling pattern); require inside the loop --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 7 NITs
**Self-generated:** 1 of the above (the rename-aside path, written in iteration 4)
- [WARNING] a read error (EACCES) was treated as damage, and the history was lost (MEASURED) --> FIXED (4c7586db15)
- [WARNING] the preview listed held agents as "retired soon" --> FIXED (4c7586db15)
- [WARNING] no test of the stopped state --> FIXED (4c7586db15)
- [CONVENTION] the plan's Shape section was stale --> FIXED (4c7586db15)
- [NIT] local date and latest-try date; dry-run of any outcome; a first tick at start; junk entries; line width --> FIXED. Save-epoch race and copy completeness --> DEFERRED (the race was fixed in iteration 7)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the rename in readLog, from iteration 4)
- [WARNING] the Settings GET could rename a file --> FIXED (fbdcee202b), set-aside is tick-only
- [NIT] a silent skip when the running-day write failed --> FIXED; unassigned repeating tasks and copy --> DEFERRED (consistent with the copy)

#### Iteration 7 (whole-branch, nothing settled)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (heldUntil, from iteration 5)
- [WARNING] heldUntil gave the wrong retry day on the day of a refusal (MEASURED) --> FIXED (aabf13b626)
- [WARNING] a change during a save in flight dropped that save's answer (MEASURED) --> FIXED (aabf13b626), browser check red on the old branch
- [WARNING] the guide check failed open --> FIXED (aabf13b626), isGuideFolderStrict
- [WARNING] the read-only view used a fresh blocking capture --> FIXED (aabf13b626), sweepRoster
- [NIT] paused heading; setting ok:false note; test title --> FIXED. Running-day granularity --> on #9228

#### Iteration 8 (whole-branch, nothing settled)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] isNamedOurs undefined was retirable --> FIXED (8e869fc26a), fail closed
- [CONVENTION] an unused timer env seam --> FIXED (8e869fc26a), removed; untested wiring --> #9228
- [NIT] header and copy notes --> DEFERRED (accurate as written)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | BLOCKER | server.js idleRetireRows | BRANCH | guide retirable on the live path | FIXED | 262b072b59 |
| 2 | 1 | WARNING | engine/idleretire.js assess | BRANCH | calendar idle, not running days | FIXED | 833b3718cd |
| 3 | 3 | WARNING | engine/idleretire.js assess | BRANCH | machine names shown | FIXED | 8cc8da9e5b |
| 4 | 5 | WARNING | engine/idleretire.js readLog | SELF | EACCES read as damage | FIXED | 4c7586db15 |
| 5 | 7 | WARNING | web/index.html saveIdleRetire | BRANCH | in-flight save race | FIXED | aabf13b626 |
| 6 | 1 | WARNING | server.js PUT | BRANCH | advisory isViaScreen | DEFERRED | same gate as Remove; plan |
| 7 | 4 | WARNING | engine/idleretire.js makeTick | BRANCH | no re-read before remove | DEFERRED | synchronous tick; plan |
| 8 | 8 | WARNING | engine/idleretire.js assess | BRANCH | isNamedOurs undefined | FIXED | 8e869fc26a |

(The per-iteration breakdown above holds every finding.)

### NITs (non-blocking, across all iterations)
- HEAD returns a body, as in the sibling routes (iteration 4)
- the running-day granularity on a board that is open for only part of the day (iteration 7, on #9228)

### Strengths (across all iterations)
- Every reader failure protects the agent; an agent with no liveness record is unknown and never retired (all rounds)
- Each protection has a control in which the same agent without it is retired (iterations 1, 7, 8)
- Retiring goes only through the board's own reversible Remove, never forced (all rounds)
- The Settings section keeps the Recommender's status contract and paints with textContent only (iterations 3, 5, 7)
