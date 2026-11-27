---
pre_challenge: true
method: challenge-loop
branch: builtmark-9176
diff_hash: efb12c51937f6018d12ef68532b22dca26577b0008b78425599781ddfc137b52
validation: passed
subdir_audit: passed
timestamp: 2026-11-27T02:38:21Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap; Splinter's 8-round rule)
**Converged:** Yes: round 8 raised no BLOCKER, and its one WARNING repeats a pattern the sibling routes already have (deferred with reason)
**Total findings:** 33 (2 BLOCKERs, 12 WARNINGs, 1 CONVENTION, 18 NITs)
**Fixed:** 2 BLOCKERs + 7 WARNINGs + 9 NITs | **Deferred / follow-up cards:** 5 WARNINGs (#9177, #9178, three with reasons) | **Asked:** 0

Final validation: queued full run on 79687ae647 (validation-log hash efb12c51937f): type-check, lint-fix, test (31606
tests, 0 fail), build. Before it: the 76 repeat, built, block and sync test files, 2259 tests, 0 fail.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [BLOCKER] engine/projects.js:4067 - the listGroup rule marked a shared task "nothing to do" for every holder when one holder marked it built --> FIXED (93a2b66e20): per-holder rule (builtFreesAll or builtWho); two-holder test
- [WARNING] engine/projects.js:4068 - "waiting on a release or a check" wrong for person/review waits --> FIXED (93a2b66e20): neutral words
- [WARNING] plan weakest premise on the wrong axis --> FIXED (rewritten)
- [NIT] x2 (test tested its own wiring; comment cited --mine) --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (none found), 2 NITs
**Self-generated:** 1 (the comment written in iteration 1)
- [WARNING] engine/projects.js:4070 - comment called the gate "the Assigner's own rule" (hasOpenWork also frees a holder with all parts closed) --> FIXED (3e3afb05af): claim deleted; the closed-parts case DEFERRED (pre-existing, needs other words)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] block and --mine disagree for a second holder --> DEFERRED to #9177 (--mine is the wrong one)
- [WARNING] "nothing to do ... unless it is reopened" inaccurate --> FIXED (e5a80930d3)
- [NIT] unnamed caller's mark test --> FIXED; shared builtFor helper --> in #9177

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [BLOCKER] server.js task built route - set/clear synced nobody, so the mark went stale (a cleared mark kept saying done) --> FIXED (df28f875e2): holders synced, owesNotice; route test + CONTROL; perturbation red
- [WARNING] predicate copies --> duplicate (#9177); [WARNING] repeating tasks --> unreachable

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] repeat route drops a built mark without syncing --> FIXED (fbe9cff9c7): sync on drop; test + CONTROL
- [WARNING] "its note says what is left" may point at no note --> FIXED: the mark names `task show <project> <n>`
- [NIT] use tellEveryoneOn; real new-mark path in the route test --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (iteration 5's read-before-write)
- [WARNING] repeat route read the task before setRepeat (race) --> FIXED (3559155865): setRepeat reports out.droppedBuilt from inside its write; real-setRepeat test; two perturbations red
- [NIT] missing project id guard --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] give and part routes drop the mark without owing the marking holder a re-read --> DEFERRED to #9178 (#8989's ground; not changed in round 7 of 8); the plan's claim corrected
- [NIT] test header and plan counts --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] the built route syncs holders inside the request (unmeasured) --> DEFERRED: the close, give and edit routes do the same
**Converged** at the cap with no BLOCKER.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/projects.js:4067 | BRANCH | per-task rule marked other holders | FIXED | 93a2b66e20 |
| 2 | 1 | WARNING | engine/projects.js:4068 | BRANCH | wait words wrong | FIXED | 93a2b66e20 |
| 3 | 2 | WARNING | engine/projects.js:4070 | SELF | comment overclaim | FIXED | 3e3afb05af |
| 4 | 3 | WARNING | engine/projects.js:4066 | BRANCH | --mine disagrees for second holder | DEFERRED | #9177 |
| 5 | 3 | WARNING | engine/projects.js:4068 | BRANCH | "reopened" wording | FIXED | e5a80930d3 |
| 6 | 4 | BLOCKER | server.js built route | BRANCH | no sync after set/clear | FIXED | df28f875e2 |
| 7 | 5 | WARNING | server.js repeat route | BRANCH | no sync on repeat drop | FIXED | fbe9cff9c7 |
| 8 | 5 | WARNING | engine/projects.js:4067 | SELF | pointed at a missing note | FIXED | fbe9cff9c7 |
| 9 | 6 | WARNING | server.js:28383 | SELF | read-before-write race | FIXED | 3559155865 |
| 10 | 7 | WARNING | server.js:835 | BRANCH | give/part owe no re-read | DEFERRED | #9178 |
| 11 | 8 | WARNING | server.js:28585 | BRANCH | sync inside the request | DEFERRED | sibling routes do the same |

### NITs (non-blocking, across all iterations)
- listed in the plan's Reviews section, round by round

### Strengths (across all iterations)
- The mark is per holder and matches the Assigner's built-and-freed test; the two-holder test pins both directions
- One mark per task: a hold or a paused project is named first, both pinned
- Every place that sets or drops the mark on this branch re-syncs the holders' blocks, each with a test and a perturbation
