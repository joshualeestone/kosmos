# alistmodel-6053: the agents list shows the whole model at phone width (kosmos#6053)

## Problem
Under 56rem `.lrow` is `grid-template-columns: 34px 1fr`. The rule sending cells to column 2
named `.lstate, .ltask, .lmem` but not `.lmodel`, so the model auto-placed into the 34 px avatar
column beside the memory bar and read "Cla..." (measured on main, mobile-shots agents-list at
393 and 360).

## Done when
At 390 and 360 px every list row shows its model in full, starting where the name starts, the
memory bar still fits on its own line, and the page has no sideways scroll.

## Change
- web/index.html: add `.lmodel` to the 56rem column-2 rule.
- docs/browser-checks/render-list-row.js: a 390/360 arm reading every row (model whole, model and
  memory bar start at the name's left edge, no sideways scroll, at least one row).

## Decisions
- Model sits just above the memory bar (auto-placement order), not directly under the role.
  Keeps model beside its memory reading (#856 order). Rejected: explicit grid-row numbers, which
  break on rows whose row count varies. Weakest premise: Josh may prefer it under the role.
- .ltitle also sits in column 1 at this width; not changed here (reads fine, separate call).
- The kremote phone layout (html.kremote) has its own more specific placement and is unaffected.
