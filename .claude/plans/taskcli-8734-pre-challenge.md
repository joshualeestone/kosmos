---
pre_challenge: true
method: challenge-loop
branch: taskcli-8734
diff_hash: 2a3c7cde73970d260a0bd63d6ade64e1a15e57523567e3abae072772340ba272
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-19T18:02:59Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes: round 8 (the cap) raised NITs only (3). Two were applied after it (an unknown option anywhere in a close is named; two tests added) and were not re-reviewed; one was left (a quietDays read assertion: the same function as the two list arms tested).
**Total findings:** 12 actionable (0 BLOCKERs, 10 WARNINGs, 2 CONVENTIONs), 28 NITs, counted from the eight reviewers' reports as tagged
**Fixed:** all actionable | **Deferred:** 0 (the --replaced-by gap from round 1 is card #8736, which Angel took) | **Asked (awaiting user):** 0

Validation: passed on Mortals through mortals-validate.sh at fce805bbba (29882 tests, 0 failed, 613 skipped; shell shards 83, 75, 78, 80 all green), "status":"clean", hash 2a3c7cde7397, equal to this worktree's.

Reproduction: every new check was run against the served 0.8.10 files themselves (server.js, engine/tasks.js, bin/kosmos from the downloaded artifact; the Windows CLI from main): all failed there, each in the way the card reports.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 7 NITs
- [CONVENTION] the room read's comment no longer described askedOfReader --> FIXED
- NITs: a closed-row control, task list's wake mark, the Windows refusal run on Windows, listed() skipping a [kosmos] note --> FIXED; the --replaced-by gap --> CARD #8736

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] a built task, plainly closed, could then be marked never run (a close takes the built mark away) --> FIXED: closedHow note/change and a landed commit count; tested
- NIT: an @-word matching two members may mean the reader --> FIXED

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] a run recorded with kosmos task ran did not count --> FIXED; tested
- [WARNING] an unmet check counted as proof it ran --> FIXED: met checks only; tested

#### Iteration 4
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] a person's post with @all plus a name was hidden --> FIXED; tested with a quoted-@all control
- [WARNING] no test for an ambiguous mention --> FIXED
- [WARNING] untested arms of item 3 (landed commit, plural, closed wording) --> FIXED
- [WARNING] a closed task was told to close it again --> FIXED

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
- [WARNING] a named post that asks the room in words was hidden; the room read and the claim guard disagreed --> FIXED: the room read uses messages.claimAskedMembers; tested
- [CONVENTION] the plain-word refusal is written beside each CLI's helper --> NO CHANGE (the helpers scan for an option to blame)

#### Iteration 6
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] claimAskedMembers was called without the room's members, so an ask to a removed agent was hidden --> FIXED: messages.roomMembersNow; unreadable means nothing hidden
- NIT: a plain-close-then-never-run control --> FIXED

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] the removed-member test used a name that was never a member --> FIXED: a real member, then removed; shown to fail with the raw member list
- NITs: the summary comment, a bulk refusal test --> FIXED

#### Iteration 8
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- an option after a plain word is named; the closed wording and a Mac bulk test --> FIXED (not re-reviewed); a quietDays assertion --> NO CHANGE
