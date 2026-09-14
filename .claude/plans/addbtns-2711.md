# Project page (tab view) styling pass, #2711, add-buttons top-right

Fifth batch of Josh's 17-item project-page (tab view) styling pass (copy #2723,
strokes #2730, white dialog #2736, search #2739 shipped). Item 10:

In the tab view, add-a-member and add-a-task become a small 22x22 "+" at the top
right of the Members / Tasks head, on the heading's baseline, instead of a
full-width button under the list. This is the treatment the consolidated view
already uses (kosmos#1303 group H); this batch ports it to the tab view, scoped
to `body:not(.consolidated)`.

## Details

- The Members card and the Tasks field become grids (`minmax(0,1fr) auto`): the
  heading takes column 1 row 1, the "+" button column 2 row 1; every other child
  spans full width. The "+" is a 22x22 square with a 1px rule border; the list
  gets a small top margin.
- Josh wants BOTH pluses on the RIGHT in the tab view. The consolidated view
  swaps the Tasks plus to the LEFT (a later #1303 revision); this batch keeps
  both on the right for the tab view, which is what item 10 asks.
- The buttons keep their ids (`#pj-add-member`, `#pj-newtask`), their wiring,
  and their accessible names. `font-size: 0` on the button hides the worded text
  while the "+" span keeps its own size, so the accessible name survives (a
  `display: none` on the text would take the name with it).

## Test note

`web.controls-1303h.test.js` pins the CONSOLIDATED tasks-plus rules with an
exactly-one-match `rule()` helper. Its needles for `#pj-tasks-field > #pj-newtask`
are re-anchored with a `.pj3 ` prefix so they match only the consolidated rule
(which carries `.pj3`), not the new tab-view rules (`body:not(.consolidated)`,
no `.pj3`). Without this the helper would see two matches and refuse.

## Gates

- #2518 surface gate: pass (the add-member / new-task buttons keep their ids;
  no browser-check-asserted surface token changed).
- #1720 gate: a `Browser-check:` trailer (CSS-only reposition/resize; the
  buttons stay clickable, which is all the add-member / task browser-checks
  exercise).

## Not covered here

Item 10 is only the ADD-button treatment. The consolidated pattern also hides
the "Remove a member" door and shows a per-row minus on hover; Josh's item 10
asks only about adding, so the removal path is left as-is.

## Not in this branch

Remaining #2711 items: 2 (remove description triangle), 3 (cog left of title),
7 (dialog always visible), 8 (hover emoji picker), 16 (member 3-state colours),
17 (remove back arrow).

## Ownership

Design + content pass on the project page, Mona Lisa's lane, assigned by Josh in
`#chaoskosmos-design`. No engine/CLI/server changes. Collision check clear.
