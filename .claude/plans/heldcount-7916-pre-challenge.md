---
pre_challenge: true
method: challenge-loop
branch: heldcount-7916
diff_hash: f732e63317ef61b09424a058a63ffe2a92f6fb1f561c7dfc3d2e459c1fa7c09e
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T12:16:52Z
iterations: 8
converged: false
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the 8-round cap, the standing usage rule: stop at 8 unless a BLOCKER is open; none was)
**Total findings:** 20 actionable WARNINGs (plus duplicates and NITs), 0 BLOCKERs
**Fixed:** 13 | **Deferred:** 6 | **Asked (awaiting user):** 0 | **Open at the cap:** 1 (recorded on kosmos#7916)

Reviewers read only (no tests run by them: the machine was carrying a release cut and validations). Per-round validation was targeted test files plus a mutation per fix; the full validation helper ran once at the end through queued-heavy. Branch is stacked on heldq-7915 (kosmos#7915); reviewers reviewed `heldq-7915...HEAD`.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html tskRow - a held question carried by a task row still said "Waiting for your answer for N" --> FIXED (70b7f13482)
- [WARNING] web/index.html pjNeedsNotice - project needs list pressed a held member --> FIXED (70b7f13482)
- [WARNING] ios/ - the phone reads neither field --> DEFERRED then folded in with April (kosmos#7918), see iteration 5
- [WARNING] engine/tasks-asknotask-7797.test.js - hand-set stateHeld --> FIXED, real held reports (70b7f13482)
- [NIT] owner-only quote; [NIT] cleanup in finally; [NIT] shared predicate --> FIXED (70b7f13482)
- Caught in flight: a line comment had swallowed the rest of pjNeedsNotice's one-line map; the #6483 test reddened; block comment now

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html tskRow / engine/tasks.js waitingOnOf - held hid a non-question reason --> FIXED: held only on a question, by isOwnQuestion's rule; page guards too (53b3f55397)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/tasks.js askingWithoutTask and web pjNeedsNotice - no crash-loop/restart gate --> FIXED: one exported predicate projects.heldOwnQuestion for every held surface (64f12c4760)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html pjAlsoWhy - "also" rows pressed a held question --> FIXED (931da49e4c)
- [WARNING] engine/phonenotice.js - push wording --> DEFERRED: a held question never buzzes (kosmos#7915, pinned by server.phonenotify-718)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] ios needsWhy "held" entries unused on this branch alone; [WARNING] phone task rows; [WARNING] heldios plan stale --> FIXED in the plan: the split with April (kosmos#7918) stated (6424c0c36c); April's remaining commits wire the notice and task rows

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] restartFailed vs disruption.failed --> DEFERRED: the member's restartFailed is derived from card.disruption.failed (projects.js)
- [WARNING] mixed held/unheld askers read pressing --> DEFERRED: the safe direction, deliberate
- [WARNING] phonenotice --> DEFERRED (duplicate of iteration 4's)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] web pjPillOf and ios projectWord - Question held outranked a task held for the person --> FIXED on both (937f76544c)
- [WARNING] needs dismiss key ignores held --> DEFERRED as a stated residual, recorded on kosmos#7916
- [NIT] unreadable control assertion --> FIXED (937f76544c)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (raised twice), 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] Today card (cardlabel.reasonOf, phone todayWhy) says "Waiting for your answer" under "Question held" --> OPEN at the cap, named in the plan and recorded on kosmos#7916 (711f19b1eb)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html tskRow | BRANCH | task row pressed held | FIXED | 70b7f13482 |
| 2 | 1 | WARNING | web/index.html pjNeedsNotice | BRANCH | needs list pressed held | FIXED | 70b7f13482 |
| 3 | 1 | WARNING | ios/ | BRANCH | phone reads neither | FIXED (with April) | 4fa468699a, 615970bf92, 3867534376 |
| 4 | 1 | WARNING | engine/tasks-asknotask-7797.test.js | SELF | hand-set stateHeld | FIXED | 70b7f13482 |
| 5 | 2 | WARNING | engine/tasks.js waitingOnOf | SELF | held hid a red reason | FIXED | 53b3f55397 |
| 6 | 3 | WARNING | engine/tasks.js askingWithoutTask | SELF | no red gate | FIXED | 64f12c4760 |
| 7 | 4 | WARNING | web/index.html pjAlsoWhy | BRANCH | also rows pressed held | FIXED | 931da49e4c |
| 8 | 4 | WARNING | engine/phonenotice.js | BRANCH | push wording | DEFERRED | held never buzzes |
| 9 | 5 | WARNING | ios needsWhy | SELF | entries unused alone | FIXED (plan) | 6424c0c36c |
| 10 | 6 | WARNING | engine/projects.js | SELF | restartFailed field | DEFERRED | derived from disruption.failed |
| 11 | 6 | WARNING | web/index.html tskRow | BRANCH | mixed askers | DEFERRED | safe direction |
| 12 | 7 | WARNING | web pjPillOf, ios projectWord | SELF | outranked heldForYou | FIXED | 937f76544c |
| 13 | 7 | WARNING | engine/projects.js needsDismissKey | BRANCH | dismiss key ignores held | DEFERRED | residual, kosmos#7916 |
| 14 | 8 | WARNING | engine/cardlabel.js reasonOf | BRANCH | Today presses held | OPEN (cap) | kosmos#7916 |

### NITs (non-blocking, across all iterations)
- heldios-7918.md carries pre-round-1 claims on this branch; April rewrites it on #7918 (iterations 6, 7, 8)
- held wording chosen by several inline ternaries; a pjWhyOf helper would keep them together (iteration 8)
- words-less fallback in server.js and phonenotice.reportWords phrase it differently (iteration 8)

### Strengths (across all iterations)
- one predicate (heldOwnQuestion, isOwnQuestion) behind every held surface; a red agent is never called calmly holding
- held added only when true, so every existing payload keeps its shape
- tests drive real producers (selfreport.record into projects.list and fleet cards) and lift the page's functions, each with an unheld control
