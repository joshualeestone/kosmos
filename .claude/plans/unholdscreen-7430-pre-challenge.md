---
pre_challenge: true
method: challenge-loop
branch: unholdscreen-7430
diff_hash: 4ed92eff7f45ec64b570e1e5f2d280273cfe4538090fc10e8d7eda06cfb8f39d
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T08:56:28Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at Baron's standing cap of 8 review rounds, no BLOCKER open; iteration 8's two findings were fixed and not re-reviewed)
**Total findings:** 40 (0 BLOCKERs, 14 WARNINGs, 1 CONVENTION, 25 NITs), plus 1 duplicate of a resolved WARNING
**Fixed:** 24 (every WARNING and CONVENTION, and 9 NITs) | **Deferred:** 16 (all NITs) | **Asked (awaiting user):** 0

Validation (6j, final): PASSED on 5cf2d104b6, stack=typescript, hash 4ed92eff7f45, 25190 node tests (0 failed), subdir
audit clean. Every fix that added a test was also measured red with the fix removed (recorded per commit).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (no loop commit existed yet)
- [WARNING] web/index.html: the unhold line and Choose who stayed after someone was put on the task; Choose who could open a held part's picker --> FIXED (e5c1a5665a)
- [WARNING] docs/browser-checks/render-unholdnext-7430.js: no arm could see either --> FIXED (e5c1a5665a, two stale-line arms)
- [WARNING] server.js: the tree sentence still named its builder by machine name --> FIXED (e5c1a5665a)
- [NIT] Choose who sat inside the aria-live region --> FIXED (e5c1a5665a)
- [NIT] CLI users are shown a display name they cannot type to assign --> DEFERRED: the CLIs print the assign command with an <agent> placeholder
- [NIT] no null guard on the click listener --> DEFERRED: matches its siblings

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 (the label-text match and the comment, both written in e5c1a5665a)
- [WARNING] web/index.html: Choose who found its part by the label "Nobody yet" --> FIXED (4167cabb79, data-pick-nobody; a stale line is taken down when no free part is found)
- [NIT] the comment on when the line goes claimed more than the code --> FIXED (claim cut to the mechanism)
- [NIT] the plan still listed the design questions as open --> FIXED
- [NIT] the out.task fallback was untested --> DEFERRED: removed in iteration 3
- [NIT] the reworded hint was a scope change --> DEFERRED: the design review asked for it

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 2 (the signature and the reload-race code, from e5c1a5665a)
- [WARNING] web/index.html: a task closed under the line kept it --> FIXED (4898b12296, closed state in the signature)
- [WARNING] web/index.html: the signature came from the reloaded task, so a hand-out before the reload was missed --> FIXED (recorded against out.task)
- [WARNING] server.js: typed display names were not cleaned of line separators --> FIXED (taskMessageSummary's expression)
- [CONVENTION] the plan described the clearing rule as complete --> FIXED
- [NIT] the nameOf comment claimed more than the code --> FIXED (claim cut)
- [NIT] the manual-marker arm reaches a state the product does not --> FIXED (comment says so)
- [NIT] two agents with one display name read as one --> DEFERRED: rare; the CLIs assign by an <agent> placeholder

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the signature, from e5c1a5665a)
- [WARNING] web/index.html: the raw route task and the board's copy could give different signatures; no multi-part arm --> FIXED (93dea5f3a5, two-part arm, red when the shapes differ)
- [NIT] tkHoldChooseShow outside the braces --> FIXED
- [NIT] the nameOf comment named less than the expression strips --> FIXED
- [NIT] quotes are stripped from names --> DEFERRED: on purpose, the Mac CLI reads the sentence with no double quote
- [NIT] the no-free-part fallback "untested" --> DEFERRED: iteration 2's arm covers it

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (tkHoldSayNext, from 4898b12296)
- [WARNING] web/index.html: a line whose task already changed flashed for up to one repaint --> FIXED (c8ac4993b0, never painted)
- [WARNING] web/index.html: TK_HOLD_ASSIGN was linked to the route's words only by the gated browser check --> FIXED (node test pins them)
- [NIT] "waits for a person to assign it" got no button --> DEFERRED then, FIXED in iteration 7
- [NIT] a display name ending in the ask --> DEFERRED: contrived and harmless
- [NIT] readIdentity is not cached --> DEFERRED: a handful of agents

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (the Choose who handler, from 4167cabb79)
- [WARNING] web/index.html: Choose who on a project with nobody on it did nothing visible --> FIXED (09917854af, says so in the line)
- [NIT] quotes stripped --> DEFERRED (as iteration 4)
- [NIT] a dropped stale line has no "now with X" --> DEFERRED: the column shows the new holder

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the signature)
- [WARNING] web/index.html: the sentence's promise depends on the project, which the signature ignored --> FIXED (7a8a196f61, pause and members in the signature; leaving the page ends the line)
- [WARNING] web/index.html: "waits for a person to assign it" offered no Choose who --> FIXED (a free part beside a held one shows it)
- [NIT] the fallback comment's claim --> FIXED (cut)
- [NIT] the name test left a folder behind --> FIXED
- [NIT] Choose who on an empty project --> DEFERRED: iteration 6's line covers it
- [NIT] commas in display names --> DEFERRED: as iteration 3

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 new WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (the Choose who handler)
**Duplicates of prior findings (confirmed resolved):** 1 (raw vs board signature shape: iteration 4's two-part arm)
- [WARNING] web/index.html: Choose who with a part's picker already open; focus lost when Choose who goes --> FIXED (5cf2d104b6: focus moves to the hold control, red without it; the picker-open case was measured unreachable, its guard's mutation stayed green, so no guard ships and an arm records the behaviour)
- [NIT] the hint wording elsewhere --> DEFERRED: grep found no other user
- [NIT] the cleaning regex is written three times --> DEFERRED: a shared helper is a separate refactor
- [NIT] the assign words are two copies --> DEFERRED: iteration 5's node test pins them
**Stopped** at the 8-round cap.

### Final Ledger (actionable findings)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | stale line after a pick or hand-out | FIXED | e5c1a5665a |
| 2 | 1 | WARNING | render-unholdnext-7430.js | BRANCH | no arm for the stale line | FIXED | e5c1a5665a |
| 3 | 1 | WARNING | server.js:6591 | BRANCH | tree sentence by machine name | FIXED | e5c1a5665a |
| 4 | 2 | WARNING | web/index.html | SELF | part found by label text | FIXED | 4167cabb79 |
| 5 | 3 | WARNING | web/index.html | SELF | closed task kept the line | FIXED | 4898b12296 |
| 6 | 3 | WARNING | web/index.html | SELF | hand-out before the reload missed | FIXED | 4898b12296 |
| 7 | 3 | WARNING | server.js:6553 | BRANCH | typed names not cleaned | FIXED | 4898b12296 |
| 8 | 3 | CONVENTION | plan | BRANCH | clearing rule incomplete | FIXED | 4898b12296 |
| 9 | 4 | WARNING | web/index.html | SELF | raw vs board signature shape | FIXED | 93dea5f3a5 |
| 10 | 5 | WARNING | web/index.html | SELF | stale line flashed | FIXED | c8ac4993b0 |
| 11 | 5 | WARNING | web/index.html | BRANCH | ask words linked only by the browser check | FIXED | c8ac4993b0 |
| 12 | 6 | WARNING | web/index.html | SELF | Choose who on an empty project | FIXED | 09917854af |
| 13 | 7 | WARNING | web/index.html | SELF | project changes ignored | FIXED | 7a8a196f61 |
| 14 | 7 | WARNING | web/index.html | BRANCH | free part beside a held one, no button | FIXED | 7a8a196f61 |
| 15 | 8 | WARNING | web/index.html | SELF | focus lost when Choose who goes | FIXED | 5cf2d104b6 |

### Strengths (across iterations)
- The page shows the route's own sentence, so the screen and both CLIs cannot drift (iterations 1 to 8).
- Agents are named from readIdentity, a file read: #7407 review 6's no-roster-read rule holds, asserted by a test (iterations 1, 3, 6).
- Every stale-line path has its own arm, each red with its fix removed (iterations 3, 5, 7).
