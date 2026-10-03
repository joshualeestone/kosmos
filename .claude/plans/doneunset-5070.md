# #5070: "Done not set" keeps its own size, under the name, on every list/Roadmap row

## Measured first
The card's reasoning blamed a sentence under the name (and a 1 / -1 span). Measured on main (a sandboxed board, both
projects done-unset): with no agents on the row, the pill was 93 px in every layout, so the description is not it.
Mona's shot shows the stretched row carrying an agent count AND a status ("3 agents", "Working"). In the Roadmap grid
(minmax(0,1fr) auto auto) those take columns 2 and 3; the unplaced pill then auto-places into a new row's first track,
and a grid item stretches (its align-self: flex-start is a flex rule and does nothing in a grid). With only one of
them, it falls into the free cell instead: the status column, at the row's end, which is why the two rows disagreed.
Measured on main with both added to a real row: 1042 px of a 1232 px row (desktop), 152 px (phone); grid view 93 px.

## Change
web/index.html: `.pj-list:not(.asgrid) .pj-row .pj-doneunset { grid-column: 1; justify-self: start; }`, so it sits
under the name at its own size, the same on every row (with or without the count and the status). Grid tiles are flex
cards and unchanged; the consolidated rail hides the pill already.

Rejected: `justify-self: start` alone (the card's suggestion): the pill stops stretching but still lands in whichever
cell is free, at the row's end on one row and under the name on the next.

Weakest premise: the count and the status are ADDED to a drawn row in the check (the markup projectCard writes), not
produced by real working agents, since the sandbox has none. If projectCard's markup for them changes shape, the arm
measures a row the page no longer draws.

## Measured (21:4x CDT, light queue turns)
- Probe on main and on the branch, Grid and Roadmap, 1280 and 390 wide, with and without the count+status: main
  stretches only in the Roadmap with both (1042 / 152 px); the branch is 93 px, under the name (left = name's left) in
  every case.
- docs/browser-checks/render-project-done-4583.js gains the arm: on main 20 passed, 1 FAILED (the new arm: 1181 px of a
  1352 px row at 1400 wide); on the branch all 21 passed.

## Review
- Round 1: PENDING.
