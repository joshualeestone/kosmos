# alistmodel-6053: the agents list shows the whole model at phone width (kosmos#6053)

## Problem
Under 56rem `.lrow` is `grid-template-columns: 34px 1fr`. The rule sending cells to column 2
named `.lstate, .ltask, .lmem` but not `.lmodel`, so the model auto-placed into the 34 px avatar
column beside the memory bar and read "Cla..." (measured on main, mobile-shots agents-list at
393 and 360).

## Done when
At 390 and 360 px every running list row shows its model in full, starting where the name starts, the
memory bar still fits on its own line, and the page has no sideways scroll.

## Change
- web/index.html: add `.ltitle` and `.lmodel` to the 56rem column-2 rule.
- web/index.html: under 56rem an empty .lmodel (not-running rows) is display:none, so it does not
  spend a line; before the fix it shared the memory cell's line.
- docs/browser-checks/render-list-row.js: a 390/360 arm. Running rows: model text whole, model
  below the name at its left edge, memory bar below the model at the same edge. Not-running rows:
  the empty model cell is not rendered. No sideways scroll; at least one running row.
- Control: the arm must go red on main's CSS (run once the machine is free).

## Decisions
- Model sits just above the memory bar (auto-placement order), not directly under the role.
  Keeps model beside its memory reading (#856 order). Rejected: explicit grid-row numbers, which
  break on rows whose row count varies. Weakest premise: Josh may prefer it under the role.
- .ltitle had the same defect (auto-placed into the 34px avatar column, spilling under it). Fixed in
  the same rule, so the role sits under the name. Reversed an earlier deferral: same class, same cell
  list, one selector.
- The kremote phone layout (html.kremote) places .lmodel itself; the wrap and :empty rules skip it
  (html:not(.kremote)), so it is unchanged.
- Under 56rem the model wraps (white-space normal, overflow-wrap anywhere) instead of being cut,
  so a long name (a Gemini 'x (set to y)' line) still reads in full.
