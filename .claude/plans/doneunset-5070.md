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
[CORRECTED round 1: my first cut put the tag UNDER the name on every row; that made every "Done not set" Roadmap row two
lines tall and pushed the fold caret off-centre.] Now: the Roadmap grid gains a fourth track before the count
(minmax(0,1fr) auto auto auto); "Done not set" sits in it on the row's one line (grid-column 2, row 1, start of the
right-hand cluster), the count and status move to tracks 3 and 4. The tag is its own size on every row, always
immediately left of the count, and the row stays one line. An empty track costs one 12 px gap on rows without the tag.
The plain list rows (an edge layout) keep `grid-column: 1; justify-self: start`. Grid tiles and the consolidated rail
are unchanged.

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
- Round 1 (opus, blind, no browsers): 0 BLOCKER, 3 SHOULD-FIX, 4 NIT. SF1 taken (a design call, mine): under-the-name made
  every done-unset Roadmap row two lines and lost the outline's density; now its own track on the row's line. SF2 (caret
  and rail elbow off-centre on two-line rows) gone with SF1. SF3: the arm's "repaint" did not remove the injected nodes
  (setLive skips identical data); it now removes them and restores the layout it found. NIT4: the arm asserts the injected
  count and status sit on the name's line (else it tests nothing), and that the tag is on that line and directly left of
  the count. NIT5: the arm runs at 1400 and 390. NIT6 (plain list wording) and NIT7 (the ancestry chip) are moot for the
  Roadmap now (nothing goes to row 2). My first rewrite of the arm demanded the same x on both rows; wrong for this
  design (the tag sits before the cluster, so its x moves with the cluster) and corrected to "directly left of the count".
  Measured 21:56 (light turns): main 20 passed, 2 FAILED (both new arms: 1181 px and off the name's line); branch 22/22.
- Round 2 (sonnet, blind, no browsers): 0 BLOCKER, 2 SHOULD-FIX, 3 NIT, taken. SF1 (reasoned): on a phone the tag, the count
  and a real status pill (with its glyph) take their tracks first and could squeeze the name to nothing (worse on child rows);
  at 40rem and narrower the tag now goes under the name (the row is two lines there: on a phone the name matters more than
  density), and the tag never wraps (nowrap). SF2: the injected pill lacked pjPillOf's three-dot glyph (~20 px narrow), and
  nothing asserted the name keeps room; the pill is now the real markup and both widths assert name >= 60 px. NIT5 taken: the
  desktop gap is asserted at 12 px (+-1) and the line at 3 px. NIT3/4: comments corrected. Residual: on a phone's two-line row the
  fold caret centres on the whole row (top: 50%), a little low; desktop rows stay one line.
  Measured 21:59 (light turn): main 20 passed, 2 FAILED (both arms; 1162 px); branch 22/22.
- Round 3: PENDING.
