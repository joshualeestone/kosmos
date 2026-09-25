# tasks-sel-3542: two #3559 browser-check reds, found measuring #3542

## Why
#3542 asked why Agent1s's headless browser fails render-* checks that pass on
Mortals. Measured 2026-09-25 with a full `tools/browser-checks.sh` on Agent1s
at origin/main aa3709b1. render-thread and render-push-718 (the checks the card
names) PASS. Angel's #3669 fixed render-thread, and it was never the browser.
Two checks were red, both from #3559 (the Tasks view, d86df814), and both are
deterministic on any box, in every engine and theme:

1. render-user-menu-3051 asserted the top nav is exactly Agents + Projects;
   #3559 added Tasks as a third tab. A stale check.
2. render-fields: `#tsk-projsel` and `#tsk-sort` had no arrow and a 9px radius
   (every other select 10px). A real look defect: `select.tsk-sel` used the
   `background` shorthand, which reset the global `select` rule's arrow
   gradients, set `padding: 0 8px` (no room for the arrow) and `border-radius: 9px`.

## Change
- web/index.html `select.tsk-sel`: `background-color` instead of `background`,
  `padding: 0 2rem 0 8px`, no own radius (the global rule's `--radius-control`).
- render-user-menu-3051.js: expects `agents,projects,tasks`; README row and
  file header updated.

## Decided
- Fix the look rather than exempt the Tasks selects from render-fields: the
  check describes the product rule (every select draws an arrow, one radius),
  and the Tasks selects were the outliers.
- Rejected: loosening render-user-menu to "contains agents and projects". The
  check's point is that the nav is exactly this set (Settings must stay out).
- Announced on #3559 (Mona's card) before building.

## Verified
- Pre-fix (frozen runner on the unfixed commit): both checks red. Post-fix:
  render-fields, render-user-menu-3051 and render-tasks-view-3559 all PASS;
  25 of 26 selects draw the CSS arrow (1 is the element-drawn #pj-sort).
- Screenshots (render-tasks-view-3559's own, light 1400 and dark 390): both
  Tasks selects show the arrow and read in both themes.

## Not verified
- Mortals was not run; the failures and fix are deterministic CSS/DOM facts,
  not timing, so the box should not matter (the weakest premise).
