---
pre_challenge: true
method: challenge-loop
branch: nomodel-8667
diff_hash: 3bd63313c76a562d8a8e1e16fd6dacce3887a357965691cf0be0d3a7a03d9eea
validation: passed
subdir_audit: passed
timestamp: 2026-11-18T04:56:48Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap of a directive from outside this loop: Splinter's standing usage rule
(2026-10-22, restated 10-26), "past round 8 only an open BLOCKER continues; one reviewer at a time". Round 8 raised
no BLOCKER; its one WARNING (a documentation gap) was fixed in the plan.
**Total findings (BLOCKER/WARNING/CONVENTION):** 17 NEW (1 BLOCKER, 15 WARNINGs, 1 CONVENTION), plus NITs
**Fixed:** 13 | **Deferred:** 4 | **Asked (awaiting user):** 0

Initial validation (6.0) was stopped before it ran (reviewer 1's BLOCKER was already known), so reviewer 1 ran as
iteration 1. Reviewer model alternated opus / sonnet.

**After round 8, not reviewed blind:** two browser-check fixes the check itself surfaced (a variable shadowing URL;
an arm whose premise was wrong) and four fixes the full suite found in this branch's own new files (README row,
$B8 list, fixture-discipline real cards, a source pin). The final browser check and the final full validation ran on
the result (validation hash 3bd63313c76a).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs (plan file present)
**Self-generated:** 0
- [BLOCKER] web.machinecost-7978.test.js:97 - pinned the card's old model-line markup and went red --> FIXED (07d4cdbb)
- [WARNING] web/index.html (My Agents click) - the link skipped #8303's guards --> FIXED (07d4cdbb), later superseded (iteration 3)
- [WARNING] web/index.html:4241 - the list row's ellipsis hid "AI Settings" --> FIXED (07d4cdbb): whole-line link with title
- [WARNING] web.nomodel-8667.test.js - the click route was checked only as source text --> FIXED (07d4cdbb): rendered check render-nomodel-8667

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs
**Self-generated:** 1 (the modelLineHtml comment)
- [WARNING] web/index.html (Switch-model menu) - "set it in AI Settings" inside AI Settings --> FIXED (a5040015)
- [WARNING] web/index.html:23498 - comment claimed a signed-out branch this diff lacks --> FIXED (a5040015): claim deleted

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs
**Self-generated:** 1 (the My Agents route and its check arms, written in iteration 1)
- [WARNING] My Agents hides the model cell; the route and check arms tested an unreachable path --> FIXED (50be0356): plain route, control arm
- [WARNING] the check never clicked the list row --> FIXED (50be0356)
- [WARNING] Runs on box and iPhone AI Settings segment still said "set it in AI Settings" --> FIXED (50be0356): short form

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (2 more deduplicated or deferred)
**Self-generated:** 1
- [WARNING] web/index.html:23523 - runsOnLine's state table named the long line --> FIXED (ecf20b48)
- [WARNING] keyboard activation / conditional asking arm --> DEFERRED: the else branch fails loudly; Enter on an anchor fires the same click
- [WARNING] latent My Agents fromProject --> duplicate of iteration 3

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs
**Self-generated:** 1 (the My Agents control from iteration 3)
- [WARNING] the My Agents control could not fail (its panel was hidden) --> FIXED (4cbbdbf0): panel shown, name must be visible
- [WARNING] render-guide-hidden-3739 still guarded the old words only --> FIXED (4cbbdbf0)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (2 deferred)
**Self-generated:** 1
- [WARNING] the modified-click arm's label claimed more than it asserts --> FIXED (dd36cd0a): relabelled
- [WARNING] the sentence repeated as a literal --> DEFERRED: deriving it from modelLine({}) breaks once #8662's signed-out line lands (plan)
- [WARNING] the iPhone tile copy has no view --> DEFERRED: no caller draws it (reviewer's own finding)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING
**Self-generated:** 0
- [WARNING] web/index.html:23490 - an agent Kosmos did not start was told to set its model in AI Settings, which refuses it --> FIXED (bd278690): full line and link only for isNamedOurs === true, board and iPhone

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING
**Self-generated:** 0
- [WARNING] a not-running card draws no model line, so the "done when" holds for running agents --> FIXED (6d0be43e): plan says so
- (CONVENTION line was an acknowledgement that the plan exists, not a finding)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.machinecost-7978.test.js:97 | BRANCH | old markup pin | FIXED | 07d4cdbb |
| 2 | 1 | WARNING | web/index.html (click) | BRANCH | My Agents guards | FIXED | 07d4cdbb, 50be0356 |
| 3 | 1 | WARNING | web/index.html:4241 | BRANCH | ellipsis hides link | FIXED | 07d4cdbb |
| 4 | 1 | WARNING | web.nomodel-8667.test.js | BRANCH | no real click test | FIXED | 07d4cdbb |
| 5 | 2 | WARNING | web/index.html (picker) | BRANCH | self-reference in menu | FIXED | a5040015 |
| 6 | 2 | WARNING | web/index.html:23498 | SELF | unbacked comment | FIXED | a5040015 |
| 7 | 3 | WARNING | render-nomodel-8667.js | SELF | unreachable My Agents path | FIXED | 50be0356 |
| 8 | 3 | WARNING | render-nomodel-8667.js | BRANCH | list row not clicked | FIXED | 50be0356 |
| 9 | 3 | WARNING | web/index.html, AgentInfoView.swift | BRANCH | long line inside AI Settings | FIXED | 50be0356 |
| 10 | 4 | WARNING | web/index.html:23523 | SELF | stale state table | FIXED | ecf20b48 |
| 11 | 4 | WARNING | render-nomodel-8667.js | BRANCH | keyboard / conditional arm | DEFERRED | fails loudly |
| 12 | 5 | WARNING | render-nomodel-8667.js:124 | SELF | vacuous My Agents control | FIXED | 4cbbdbf0 |
| 13 | 5 | WARNING | render-guide-hidden-3739.js:79 | BRANCH | old-words guard | FIXED | 4cbbdbf0 |
| 14 | 6 | WARNING | render-nomodel-8667.js | SELF | overstated label | FIXED | dd36cd0a |
| 15 | 6 | WARNING | web/index.html:23497 | BRANCH | literal repeated | DEFERRED | plan: #8662 trap |
| 16 | 6 | WARNING | BoardLogic.swift:1059 | BRANCH | undrawn iPhone tile copy | DEFERRED | no caller |
| 17 | 7 | WARNING | web/index.html:23490 | BRANCH | not-ours agent told to use AI Settings | FIXED | bd278690 |
| 18 | 8 | WARNING | plan | BRANCH | stopped agents show no line | FIXED | 6d0be43e |

### NITs (non-blocking, across all iterations)
- Repaint flake risk in the browser check (2; fixed by redrawing before each arm)
- headless flag reads inverted (2, 8; same as sibling checks)
- Focus after a keyboard open (7; parity with the name's open)
- Stale "Unknown Model" comments in engine/status.js and engine/create.js (8)

### Strengths (across all iterations)
- Session name URL-encoded in the address and escaped in the attribute, tested with a hostile name built through test-support/fleet
- The click route sits after the star and before the answer route and the plain open; modified clicks follow the real #7280 address
- Every other reader of the model line moved together: tile borrow, list cell, Runs on, Switch menu, guide check, iPhone mirror
