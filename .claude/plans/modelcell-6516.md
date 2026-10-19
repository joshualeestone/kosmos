# modelcell-6516: the Agents list does not repeat "Made before Kosmos recorded this" on every row

Card: kosmos#6516 (Mona Lisa's review of #6511). On the Agents LIST the model cell showed #150's ruled sentence, cut
off, on every row whose launch was never recorded (every row on a board set up before Kosmos).

## Check first (the card's asks)
- #150's ruling (closed by #454) set the WORDING, "Made before Kosmos recorded this", "wherever there was never anywhere
  to look", paired with "Unknown Model" for the fault. It does not say every surface must show it. The words stay
  unchanged, and the card and the agent page still show them.
- Tests that lift modelLine: web.made-before.test.js (and the card in docs/browser-checks/render-made-before.js).

## Change
- `web/index.html`: `lmodelCell(a)` draws the list's model cell. When modelLine's answer is its never-recorded
  sentence (recognised as `modelLine({ neverRecorded: true })`, so the sentence is written once), the cell holds it
  in a `.vh` span: read to a screen reader, not shown. Any other answer, "Unknown Model" included, is shown as before.

## Decisions
- Hidden, not a dash: a dash says "unknown", which is the fault's meaning (#150's pair); empty plus a screen-reader
  sentence loses nothing. Rejected: a title tooltip (a hover-only fact on a list row).
- Weakest premise: an empty model cell is clear enough on a list where the card and agent page say why.
- Known and accepted (review 1 NIT): below 56rem the cell no longer matches `.lmodel:empty`, so it keeps its grid row
  (zero height, the 8px row gap). Less space than the visible sentence took before.
  Likewise on the phone remote layout (html.kremote), where .lmodel is pinned to grid row 3: a 2px empty row.
- render-list-row.js (live board): its phone arm reads the shown text (.vh removed), checks a never-recorded running row
  as holding only the screen-reader sentence on a slot that still spans a full-width line. (Requiring a running row
  that SHOWS a model was tried and dropped: CI's fixture board records none, so the check went red, PR #6528.)

## Checks
- web.made-before.test.js: the cell is the .vh sentence for never-recorded; "Unknown Model" and a real model are shown
  (CONTROLS); a model name is escaped; the list row calls lmodelCell. Mutation: reverting either fails its test.
- render-made-before.js: in list view, Rick's cell shows nothing (its text with the .vh span removed is empty, and its
  only child is the 1px .vh box: .vh clips rather than removing, so innerText would still return it) and keeps the
  sentence as text; Bob's shows his model
  (CONTROL); the card still wears the sentence (existing check).
