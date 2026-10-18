---
pre_challenge: true
method: challenge-loop
branch: taskproj-6481
diff_hash: 6566b8784996cd625d348c7ccd49c933319e5c0d40fd10a655f7418864935e99
validation: passed
subdir_audit: passed
timestamp: 2026-10-18T15:30:15Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Total findings:** 1 BLOCKER, 19 WARNINGs, 0 CONVENTIONs across 7 iterations (plus 13 NITs)
**Fixed:** the BLOCKER and every WARNING | **Deferred:** 0 | **Asked:** 0

Validation (6j): tools/run-tests.sh through queued-heavy at 3ad81b5a, the reviewed commit (the squashed commit has the
same tree, 53e7fe64): node 21953 tests, 21655 pass, 0 fail, 0 cancelled, 298 skipped (the 14 tests in
web.tasks-one-project-6481.test.js among the passes); shell 250 of 250; bc-surface-map 0 failed. RUN_EXIT=1 came from ONE
gate only, the #2518 browser-check surface gate: render-subback-4586.js and render-alltasks.js read the tsk-title
surface and were not edited. Both were reviewed as unaffected (render-subback-4586 asserts geometry only; the
render-alltasks title regexes, ^N Tasks? on and on X$, still match the unchanged "on" wording), so the squashed commit
carries a per-check Browser-check-surface trailer for each, and the surface gate and the #1720 gate run alone on the
squashed commit then passed (GATE_EXIT=0, both overrides read). run-tests.sh runs the browser-check GATES, not the
checks themselves, so the two edited checks (render-tasks-view-3559.js, render-taskhover-4880.js) did not execute in
this run; CI's browser-check workflows run them.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] with All projects narrowed to one project by a search, a window or a tile, the project's name was gone from
  the screen --> FIXED (with no Project filter and at least one open task, the title names the project by its full path,
  tskTitle; decided on the card)
- [WARNING] the plan's weakest premise understated the cost --> FIXED (rewritten: the name stays on screen, the
  one-click link is what goes)
- [WARNING] closed rows have disabled checkboxes, so a keyboard user there loses the project name --> FIXED (the line
  is left out only when the crumb or the title names the project; stated in the plan)
- [NIT] focus on a removed project button moves to the Project filter --> FIXED (stated in the tskRow comment and the plan)
- [NIT] the one-project row at 390 was never measured --> FIXED (a 390 arm, with and without the project button)
- [NIT] the paint order pin reads source --> not acted on, non-blocking (kept, labelled order only; the browser checks
  cover behaviour)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] "on" plus the leaf with the filter, "in" plus the full path without --> FIXED (one preposition, "on", as the
  card's refined decision says; the leaf when picked, the crumb carrying the path)
- [WARNING] only closed tasks of one project titled "0 Tasks in X" --> FIXED (0 open names no project, and the rows keep
  the line; test)
- [WARNING] a tile changed the title's count --> FIXED (title and line both read the view before the tile; test)
- [WARNING] an order-pin message stated the opposite of its assertion --> FIXED
- [WARNING] the title-to-meta spacing at 390 was not asserted once the button is gone --> FIXED (gap asserted on both rows)
- [NIT] review history in code comments --> FIXED (none in the new comments)
- [NIT] missing title cases (picked with Completed, mixed open and closed, an empty read) --> FIXED (tests)

#### Iteration 3
**Reviewer model:** opus
- [NIT] the tskRow comment named the wrong function and set --> FIXED
- [WARNING] no width check on the longer unfiltered title (and no 320 arm, which nothing claims) --> FIXED (a longest-title
  arm at 390: wraps inside its row and the window, no sideways scroll)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] "the set the title counts" vs closed tasks in view --> FIXED ("every task in view, open or closed" in the
  code, the plan and the card)
- [WARNING] the tile test never exercises a tile --> FIXED (renamed and commented as what it is; the order pin and the
  browser check carry the tile)
- [WARNING] no case for open tasks in A plus a closed task in B --> FIXED (test)
- [WARNING] the 0 to 32px gap bound is loose --> FIXED (12 to 20px)
- [WARNING] the long-title arm sets TSK.data without saying so --> FIXED (comment says it paints rows set in the page)
- [WARNING] the plan's closed-row keyboard claim was unverified --> FIXED (wording tightened to the cases the rule covers)
- [NIT] a comment wrapped mid-sentence --> FIXED
- [NIT] the check's header kept the old title examples --> FIXED

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] the 390 gap was measured from the title button's rect, which reaches 15px below its text under hover: none,
  so a correct page measured 1px --> FIXED (measured from the title text: the .tl rect less its computed padding-bottom)
- [WARNING] the comment's bound claim rested on the wrong model --> FIXED (rewritten with the measured model)
- [NIT] the plan said tskLeaveOutProjectLine sets the field --> FIXED (pure; tskPaint sets it)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] the "measured 16px" figure was not confirmed by the reviewer --> FIXED (the figure is from a probe through
  the real page at 390x844 with touch, 16px on both rows, dated in the comment; the reviewer's arithmetic agrees)
- [WARNING] the comment cited #6396 as a ruling on this line --> FIXED (cited as an analogy; the card is the source)
- [WARNING] the plan's closed-row sentence read wider than the rule --> FIXED
- [NIT] the order pin could match tskList( in a comment --> FIXED (comment lines skipped; the limit is stated)
- [NIT] the 390 arm leaves the Project filter set --> not acted on, non-blocking (the context closes next)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] the test file's header understates the rule (the 0-open case) --> not acted on, non-blocking
- [NIT] the tskRowsShareOneProject comment says "row" where its siblings say "task" --> not acted on, non-blocking
**Converged**: no new actionable findings.

### Strengths
- One rule decides both the title and the line from the same pre-tile array, so they cannot disagree; every case on the
  card has a unit test with a control, and the browser check reads the drawn rows.
