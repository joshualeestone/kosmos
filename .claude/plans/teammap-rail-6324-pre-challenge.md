---
pre_challenge: true
method: challenge-loop
branch: teammap-rail-6324
diff_hash: c582d648d294c78be84665da28d1cd7cfbd64fbd645c08a0fa0ec17cd35b3c37
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T11:36:35Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12 blind reviews, alternating opus and sonnet (this formal run, on the branch rebased onto main after #6103 landed; 17 earlier blind rounds ran on the stacked branch before it)
**Converged:** Yes (iteration 12, sonnet: one WARNING, a duplicate of a deferred entry; nothing new)
**Total findings:** 15 distinct actionable (0 BLOCKERs from reviewers, 11 WARNINGs, 1 CONVENTION, 1 synthetic final-validation BLOCKER, 2 PR CI reds), 36 NITs
**Fixed:** 11 | **Deferred:** 4 (plus 7 duplicates of deferred entries) | **Asked (awaiting user):** 0

Origin: every finding is recorded BRANCH, the fail-safe default. The 6c-bis blame lookup was not run mechanically for this loop, so no finding was treated as SELF and no fix took the SELF prose path.
Validation between iterations: focused tests (the #6324 and #6103 units, project-notice-3923, consolidated-980 and the repo-wide browser-check meta tests, 50 to 64 passing, 0 failing) after each fix; the full suite is the final gate below, on the final head.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above (lookup not run; recorded BRANCH)
- [CONVENTION] .claude/plans/teammap-rail-6324.md:3 - plan still said stacked on #6103, which has landed --> FIXED (commit 2784505c)
- [WARNING] web/index.html paintRailTeamMap vs paintOneProject - two hand-kept copies of the member filter can drift (they did on 10-16) --> FIXED (commit 2784505c): a unit arm holds the rail, tab and map filters to one text, mutant-checked; a shared helper would break six tests that lift paintOneProject alone
- [NIT] hidden scrollbar on the capped map; [NIT] pjTeamMap rebuilt each poll; [NIT] focus branch not unit-covered; [NIT] byte-equal test passes no redHere

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:5362 - a long notice plus the open map can scroll the page --> DEFERRED: the plan's "NOT covered", as a long notice alone does today; filed as #6347
- [WARNING] web/index.html:5364 - the capped map hides its scrollbar --> DEFERRED: #867 consistency, named in the plan and put to the design review on the card
- [WARNING] web/index.html:24638 - focus falls to the page when the last focused member leaves --> DEFERRED: the plan records it; nothing in the map is left to focus
- [NIT] typeof guard on paintRailTeamMap (needed: web.project-notice-3923 lifts paintRailPjNotice alone, measured red without it); [NIT] click handlers repeat the tab's; [NIT] filter copied three times

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [NIT] plan contradicted itself on the head row's height --> fixed anyway (commit a224eebc): `auto` in the CSS, measured 604px with the map closed and open
- [NIT] painters drift on focus-to-button; [NIT] hidden tab box still painted; [NIT] plan filename has no timestamp; [NIT] squash on merge
**Converged** on this pass; a plan wording fix followed, so the loop ran on.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 2 (focus to the page; notice plus map, both DEFERRED)
**Converged.** The design shots (taken next) then found the Team map button buried under the agents list in the shots' sample data (a 638px notice in a 504px head). The button and map moved ABOVE the notice (commit ce7ca2a9, with a unit order arm and a browser arm that forces the notice tall, CONTROL included), and the loop ran on over the new code.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:62479 - the map's hint said the list is "above the members", false in the rail --> FIXED (commit 6a676eef): "the needs-you list says what each one is waiting for"; web.teammap-6103.test.js follows the words
- [WARNING] web/index.html:19897 - an open map lowers the needs-you notice --> DEFERRED: the plan's named trade, put to the design review
- [NIT] #3948's comment sat above the new markup --> fixed (commit 6a676eef); [NIT] scrollTop read each poll; [NIT] hidden tab map painted; [NIT] stand-in drops scrollTop; [NIT] stray h4 in the rail

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (focus to the page)
- [WARNING] web/index.html:24636 - the map painted after the notice's early return on a missing element --> FIXED (commit c59c5ef6): painted first; unit arm with no notice element, red on the old order

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (focus to the page)
- [WARNING] docs/browser-checks/render-teammap-rail-6324.js:212 - called 960x720 the shortest window the layout keeps; there is no height floor --> FIXED (commit 786ed5d7): the comment says 720 is measured, the plan lists below 720 as not measured
- [NIT] hint less specific in the tab layout; [NIT] filter copies; [NIT] typeof guard; [NIT] swallowed waitForFunction timeouts; [NIT] the scroll-keep arm is a guard, not coverage

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

#### PR CI on #6354, after iteration 8
- [BLOCKER] CI render-phone-taps-5218, tablet 1366 one-screen: the Team map button covered by the first name's touch reach (#5218 ::after) --> FIXED (commit b6398b08, rebased): the button and the map are positioned and raised (z-index 1); that check is the guard and ran green locally on the fix
- The branch was then rebased onto main past railnotice-6347 (PigeonPete), which conflicted at the rail head's CSS; both blocks kept, the diff re-checked line for line (852 lines both sides)
- [BLOCKER] CI render-projects, #6347's arm: with the Team map button showing, the 40vh notice cap ran 32px under the list at 560 tall --> FIXED (commit 4a825399, then 3aa287e9): the cap gives back the button's line, calc(40vh - 52px); that arm is the guard

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:5367 - raised above the list, an overflowing map now takes the clicks of the rows under it --> FIXED (commit a3aad690): stated in the plan, reasoned from the CSS, not measured
- [NIT] the new rule was not indented with its block --> fixed (a3aad690)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged**; the PR CI reds above followed, so the loop ran on.

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (notice plus open map)
- [WARNING] web/index.html:5368 - the cap's 44px give-back did not match its own sum and left out the button's 8px margin --> FIXED (commit 3aa287e9): 8 + 36.4 + 6 = 50.4, cap calc(40vh - 52px), sum written at the rule
- [NIT] the plan still called the notice uncapped --> fixed (3aa287e9)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (1 raised, a duplicate of the deferred focus case), 0 CONVENTIONs, 4 NITs
**Converged** - no new actionable findings.

#### Final validation (6j)
- [BLOCKER] final-validation: the browser-check surface gate (#2518) named render-shell-noscroll-4872.js, whose 'consolidated' token changed --> FIXED (commit 9208a3bb): ran that check against this branch (72/72, Chromium at five sizes and WebKit) and recorded the per-check trailer; an empty commit, so the code diff is unchanged
- Earlier: the next run (00:53) went red only in tools/test-publish-r2-3725.sh: every pwsh call on this Mac aborted rc=134, a machine fault since fixed (kosmos#6352). Discarded per Splinter; the rerun at 02:06 on 9208a3bb PASSED (hash ee7504540177), no rc=134 anywhere in it, and the 6j helper call then skipped on that clean entry.
- On the final head 3aa287e9 (after the CI fixes): validation PASSED at 06:36 (hash c582d648d294), no rc=134 in the run; the 6j helper call skipped on that clean entry; PR CI 8/8 green on the same head.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/teammap-rail-6324.md:3 | BRANCH | plan says stacked on #6103 | FIXED | 2784505c |
| 2 | 1 | WARNING | web/index.html paintRailTeamMap | BRANCH | duplicated member filter can drift | FIXED | 2784505c |
| 3 | 2 | WARNING | web/index.html:5362 | BRANCH | long notice plus map can scroll the page | DEFERRED | plan "NOT covered"; #6347 |
| 4 | 2 | WARNING | web/index.html:5364 | BRANCH | hidden scrollbar on the capped map | DEFERRED | #867 consistency; design review |
| 5 | 2 | WARNING | web/index.html:24638 | BRANCH | focus to the page when the last member leaves | DEFERRED | plan records it |
| 6 | 5 | WARNING | web/index.html:62479 | BRANCH | hint points "above the members" | FIXED | 6a676eef |
| 7 | 5 | WARNING | web/index.html:19897 | BRANCH | open map lowers the needs-you notice | DEFERRED | named trade; design review |
| 8 | 6 | WARNING | web/index.html:24636 | BRANCH | map rides the notice's early return | FIXED | c59c5ef6 |
| 9 | 7 | WARNING | render-teammap-rail-6324.js:212 | BRANCH | 720 called a floor | FIXED | 786ed5d7 |
| 10 | 6j | BLOCKER | final-validation | BRANCH | surface gate: noscroll check not updated | FIXED | 9208a3bb |
| 11 | shots | WARNING | web/index.html rail head | BRANCH | button buried under the list by a long notice | FIXED | ce7ca2a9 |
| 12 | CI | BLOCKER | web/index.html rail CSS | BRANCH | Team map button under the first name's touch reach | FIXED | b6398b08 |
| 13 | CI | BLOCKER | web/index.html rail CSS | BRANCH | notice cap ran under the list with the button showing | FIXED | 4a825399, 3aa287e9 |
| 14 | 9 | WARNING | web/index.html:5367 | BRANCH | overflowing map takes the rows' clicks | FIXED | a3aad690 (plan) |
| 15 | 11 | WARNING | web/index.html:5368 | BRANCH | cap give-back did not match its sum | FIXED | 3aa287e9 |

### NITs (non-blocking, across all iterations)
- Hidden scrollbar on the capped map (iterations 1, 6); pjTeamMap rebuilt each poll, and the hidden tab map also painted (1, 3, 5); the member filter copied three times (2, 3, 6, 7); the typeof guard (2, 7); the focus branch not unit-covered (1); swallowed waitForFunction timeouts (7); the scroll-keep browser arm is a guard (7); a stray h4 in the rail (5); the plan filename has no timestamp, as most sibling plans (3); squash on merge (3)

### Strengths (across all iterations)
- The rail calls the one pjTeamMap and shares PJ_TEAMMAP_OPEN, so the shape and the open state cannot disagree between layouts; a unit arm proves the rail markup is byte-equal to the tab map
- Riding paintRailPjNotice gives the map every repaint path the notice has (poll, project read, layout switch) with no new wiring
- Nearly every browser arm has a control that can return the bad answer (label pushed, node forced wide, cap removed, padding removed, button moved under a tall notice, repaint that really replaces the node)
- The button move came from measured data in the design shots and is pinned by both an order test and an elementFromPoint arm
