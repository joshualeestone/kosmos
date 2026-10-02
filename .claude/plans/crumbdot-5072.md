# crumbdot-5072: the Tasks crumb's dot wraps with Open project

Card: joshualeestone/kosmos#5072 (Mona Lisa's nit on #5053's design shots).
Stacked on chevwrap-5053 (it needs that branch's `project-tasks` mobile-shots screen and its long-name phone arm in
render-subback-4586.js). Merges after #5053.

## Problem
For one project the Tasks crumb is `All tasks › <name> · Open project`. On a phone, when Open project wraps to the
next line, the ` · ` stays at the end of the first line and dangles.

## Decision
Wrap `· Open project` in one `<span class="tsk-crumb-open">` with `white-space: nowrap`, so the dot moves with the
button. Desktop (no wrap) renders the same text on one line.

Rejected: dropping the dot at phone width (needs a breakpoint guess; a short name that fits on one line would lose its
separator); a pseudo-element dot (moves the character out of the text, so copy and screen readers change).

Weakest premise: the leading dot on the second line (`· Open project`) reads fine. That is a design call; Mona Lisa
can override it to "no dot when wrapped", which CSS alone cannot detect.

## Pin
render-subback-4586.js, the #5053 long-name loop at 390 and 360: (a) the crumb really wraps (the arm tests
something); (b) the `·` character (found by a text walk, wherever it sits, so the assert reads the same on old markup)
is on Open project's line. Expected to FAIL on the unmodified markup: run both arms when a test slot is free.

Selectors other checks use (`#tsk-crumb button`, `#tsk-crumb [data-open-project]`, `[data-proj=""]`, the crumb's
`textContent === ''` when no project) are descendant/textual and unaffected by the span.

## Status
- Fix + pin committed; design shots at ~/work/design-shots/kosmos-5072 show the dot on the second line, desktop same.
- Both static gates pass.
- TODO: blind review; run render-subback-4586.js on the fix and on the old markup (control) in a free slot; validation.
