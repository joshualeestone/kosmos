# blankany-7420: a list with nothing drawn is rebuilt whatever the reader's place

Card: kosmos#7420. TestFlight 37 (from main 6fe43620f1) still blanked on Josh's phone, 11-04 08:07
(~/.cache/claude-handoffs/josh-7420-diag-build37-0807.txt): "keyboard settled: within, nothing drawn" twice, rows on
screen 0, at newest FALSE (the anchor a message; "end disappear (personScrolling true)" just before), and the reported
blank's one try "rows said to appear 0".

## What finished looks like
A chat list with nothing drawn within its content is rebuilt on the reported blank and at a settled look, whatever the
anchor, so the person sees rows again. Josh's phone is the test (the simulator never shows this blank).

## Measured
- Board.emptyRecovery returned .rebuild only with atNewest; otherwise the first try went to the newest by id, which
  build 34 already showed lands in the same undrawn stretch.
- settledPutBack acted only with atBottom; a blank list for a reader who had scrolled was traced and left.

## Change
- ios/Kosmos/BoardLogic.swift: emptyRecovery rebuilds a list within its content with nothing drawn on the first try
  (`later` false) whatever atNewest, and a later automatic look still only at the newest. `canRebuild` carries the
  Debug no-rebuild control (it rode on atNewest before).
- ios/Kosmos/ChatView.swift: settledPutBack's arm runs for `atBottom || onScreen.isEmpty`, so a blank list is rebuilt
  whatever the anchor (a drawn list is still moved only at the newest), with the same guards (rows, drawn once, end not
  showing, app active, the rebuild grace and budget). The rebuild's trace says whether the reader was at the newest.

## Decided
- A rebuild opens the list at its newest, so a reader who had scrolled up is moved there. A blank screen holds no place
  worth keeping. Rejected: rebuilding at the reader's place (no way to do it today).
- The periodic look (diagCheck's later recovery) keeps leaving a reader higher up alone: a list mid-draw in a fast scroll
  can be empty for a moment. Review 1: the settled look is automatic too, so for a reader higher up it rebuilds only once
  the list is still blank `blankConfirm` (0.5 s) later, with the same guards read again; a rebuild sets atBottom (the new
  list goes to its newest), so a rebuilt list that stays blank is rebuilt again by the later look, within the budget; and
  the Debug no-rebuild switch leaves a reader higher up untouched, as before.
- Weakest premise: that the person's scroll had ended by the look. The trace shows personScrolling true just before;
  PersonScroll follows the scroll phase and clears when it rests, but if the blank comes with a scroll that never rests,
  this does not fire either.

## Tests
LogicTests main.swift: the first empty-within list rebuilds whatever the anchor; the no-rebuild control; a later look
still leaves a reader higher up. room/main.swift pins the settled arm. Typecheck Release and DEBUG.
- Review 2: the delayed confirm reads every guard again (app active, rows, the rebuild grace too). With the budget spent,
  a reader higher up rebuilt by a settled look is not sent to the newest by id (keepPlace). Accepted and stated: a rebuild
  sets atBottom true; if the rebuilt list never reaches its end it stays true (the keyboard hold stands down, a new message
  moves the list) until the person scrolls or the end shows, which on a blank screen costs nothing.
