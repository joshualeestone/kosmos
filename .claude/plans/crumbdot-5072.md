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

Markup: `name <span class="tsk-crumb-open"><span class="tsk-crumb-sep">·</span> <button ...>Open project</button></span>`.
The phone rule (`@media (max-width: 30rem)`, the room's phone query) sets the open span to block and hides the sep.

Superseded: my first build (dot leads line 2). Rejected by the designer.

Weakest premise: 30rem is the line. Between 30rem and 40rem (the repo's other phone breakpoint) a long name can still
wrap, and there the nowrap unit applies (dot kept, moves with the button).

## Pin
render-subback-4586.js, crumbGeom(): dots found as characters and counted as drawn when their box has width.
- 390 and 360 (phone): Open project below All tasks, at the crumb's left edge; zero dots drawn. Expected to FAIL on the
  old markup (the dot is drawn there).
- 700: exactly one dot drawn, on Open project's line.
Other checks' selectors (`#tsk-crumb button`, `[data-open-project]`, `[data-proj=""]`, empty-crumb textContent) are
descendant/textual and unaffected. textContent is unchanged.

## Status
- Fix + pin committed. Shots in ~/work/design-shots/kosmos-5072 show the SUPERSEDED first build: retake.
- Both static gates pass.
- TODO: retake shots; blind review; run render-subback-4586.js on the fix and on the old markup (control) in a free slot; validation.
