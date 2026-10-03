# crumbdot-5072: the Tasks crumb's dot wraps with Open project

Card: joshualeestone/kosmos#5072 (Mona Lisa's nit on #5053's design shots).
Stacked on chevwrap-5053 (it needs that branch's `project-tasks` mobile-shots screen and its long-name phone arm in
render-subback-4586.js). Merges after #5053.

## Problem
For one project the Tasks crumb is `All tasks › <name> · Open project`. On a phone, when Open project wraps to the
next line, the ` · ` stays at the end of the first line and dangles.

## Decision (Mona Lisa's design call, 2026-10-02 18:08, reasoning on the card)
At 30rem and below: Open project always on its own line, and the separator dot is not drawn (a dot starting a line
reads as a stray mark; phone names wrap almost always, so one fixed layout). Wider: the dot stays, and `· Open project`
is one nowrap unit so the dot never dangles at a line end.

Markup: see the crumb in renderTasks (web/index.html, search tsk-crumb-sep). The dot is aria-hidden with a vh comma
beside it (the .pj-crumb-sep pairing); on a phone the dot is hidden and the comma stays on purpose, so a screen
reader still hears a pause before Open project.
The phone rule (`@media (max-width: 30rem)`, the same query the project room's phone CSS uses; the Tasks head's own phone grid is 40rem) sets the open span to block and hides the sep.

Superseded: my first build (dot leads line 2). Rejected by the designer.

Weakest premise: 30rem is the line. Between 30rem and 40rem (the repo's other phone breakpoint) a long name can still
wrap, and there the nowrap unit applies (dot kept, moves with the button).

## Pin
render-subback-4586.js, crumbGeom(): dots found as characters and counted as drawn when their box has width.
- 390 and 360 (phone): Open project below All tasks, at the crumb's left edge; zero dots drawn. Expected to FAIL on the
  old markup (the dot is drawn there).
- 700, with the crumb cut to end 20px past the name: Open project wraps (arm), exactly one dot drawn, on Open
  project's line (the nowrap unit; expected to fail on the old markup, where the dot fits on line 1).
- 30rem to 40rem: no viewport arm; the same above-30rem rule as 700. Touch (hover: none, 44px buttons) is reasoned, not run.
Other checks' selectors (`#tsk-crumb button`, `[data-open-project]`, `[data-proj=""]`, empty-crumb textContent) are
descendant selectors or an empty-text test.

## Review (challenge loop, blind, alternating Opus/Sonnet; diff vs origin/chevwrap-5053)
Converged at iteration 8 (Sonnet): no BLOCKER/WARNING/CONVENTION. Rounds 2-8 reviewed Mona Lisa's layout (round 1 the
superseded build). Fixed along the way: arm guards that could pass vacuously or on font luck (1, 2, 3, 7), an
unmeasured midpoint tolerance (2), a hidden crumb passing (3), the 30rem/40rem wording (3), README row (4), a missing
surface token tsk-crumb-sep (5), a false "textContent is unchanged" plan claim written by this loop, deleted (6).
NITs left: touch (hover: none) between 30rem and 40rem is reasoned, not run; the 700 "wraps" arm alone does not
discriminate (the dot assert after it does).
NOT DONE, and required before the proof: step 6j validation, which waits for #5053 to merge and this branch to be
rebased onto main (the proof's diff_hash is against main), and a free test slot.

## Status
- Shots in ~/work/design-shots/kosmos-5072 show the SUPERSEDED first build: retake.
- Static gates pass at 43e68384d (both, rerun 18:21).
- TODO, in order: run render-subback-4586.js on the fix AND on the old markup (control: expect the 5072 asserts to fail)
  in a free slot; retake shots and post on #5072 for Mona Lisa; after #5053 merges, rebase onto main, validation (6j),
  proof, PR, merge.

## Validation 1 red (01:34): the #4811 surface-gate self-test read the live checks map
- tools/test-browser-check-surface-gate.sh's compliant-change arms hard-coded render-alltasks.js as the only check
  that claims tsk-crumb, against the REAL docs/browser-checks folder. This branch rightly adds tsk-crumb to
  render-subback-4586.js (it tests the crumb), so 3 arms went red. Green on main, red here, same machine: not
  contention.
- Fix: the arms now list every check that claims tsk-crumb (a setup arm asserts render-alltasks.js is among them, so
  the arms cannot go vacuous). Green here (both checks found) and on an origin/main control (one found).
- Rejected: dropping tsk-crumb from my annotation. It would make the map less true to pass a test that read live state.
