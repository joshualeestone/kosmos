---
pre_challenge: true
method: challenge-loop
branch: gutter-4216
diff_hash: 4420fd8a7346de0314f72e7f76565a9c30f02f11b0c5715ce74545154a48128c
subdir_audit: passed
timestamp: 2026-09-27T16:58:24Z
converged: true
---

## Challenge loop: #4216 the Tasks white band meets the window's edge on classic-scrollbar machines

#### Iteration 1 (blind, opus), on the first build (drop the gutter on Tasks)
- [HIGH] the check arm could never fire: CI browser-checks run on macOS headless, which hides scrollbars
  (--scrollbar-width 0) --> FIXED by the redesign: the arm asserts the computed canvas colour, which holds anywhere.
- [MEDIUM] dropping the gutter moves the fixed assistant bubble, chat and nudge 15px between tabs --> FIXED: approach
  replaced (canvas = surface; nothing moves).
- [LOW] the list shifts 15px while filtering or searching --> FIXED by the same replacement.
- [LOW] each click re-lays out the list (the measure) --> moot after the replacement (no per-view gutter).
- [LOW] a misleading brace in the check --> FIXED (the check was rebuilt from main plus one arm).

#### Iteration 2 (blind, sonnet), on canvas = surface
- [MEDIUM] on an overlay-scrollbar Mac a rubber-band bounce shows the white canvas above the ground header --> FIXED:
  scoped to data-scrollbar-classic (gutter > 0), set by kosmosMeasureScrollbarWidth.
- [LOW] no negative arm --> FIXED: a leak arm (attribute forced, Tasks hidden: not the surface).

#### Iteration 3 (blind, opus)
- [LOW] the attribute and --scrollbar-width came from different gates --> FIXED: set together, after the vw check,
  and removed with data-scrollbar-measured when the measure fails.
- [LOW] the mouse + trackpad bounce was not named --> FIXED: in the plan's weakest premise.
- [LOW] the arms assume the tour is not dimming; the stale attribute on a consolidated switch --> ACCEPTED: the check
  never runs the tour there, and the rule excludes consolidated (and switching re-measures).
- No HIGH or MEDIUM. NO NEW FINDINGS of substance.

## Evidence
- render-tasks-view-3559: 12 #4216 PASS (3 arms x light/dark 1400, light 760, dark 390); with main's page the forced
  arm FAILS (the canvas is transparent).
- render-subtasks-3861 and render-help-tips-3574 (flagged by #2518) run on the branch: pass; trailers added.
- web.*.test.js 1994/1994; full suite 10781 pass, 0 fail, exit 0. #1720 and #2518 gates pass.
- CI (classic scrollbars, 15px): the three #4216 arms pass with had:true, sbw:15. One earlier run failed the top-band
  edge read; the INFO line added to the arm showed why: in CI clientWidth reports 1400 while the body ends at 1385, so
  a read at clientWidth-2 lands in the gutter (the documented strip beside the top band). Main's check now reads at
  the page layout's edge, and the rerun is green (browser-checks run 36336521264 at 81cc7c5ea).
