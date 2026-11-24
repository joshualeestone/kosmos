# taskundo-8958: undoing a closed task's file changes, on the iPhone's task page (kosmos#8958 slice B5)

## Goal
The board's tk-undo (#5153 slice 4) natively, under the receipt. Stacked on the #8985 stack (59ac545b3f); rebased onto main
once #8985 merges.

## What the board does (read 2026-11-24)
- paintTaskUndo(n), only after a receipt draws: GET /api/project/<id>/task/<n>/undo. Nothing is shown unless `on` and
  `files` is not empty. Hidden when the receipt goes (tkUndoHide). Sequence numbered; a failed read shows nothing.
- "Undo this task's file changes" (a link) opens the list: heading Undo, the sentence "These files go back to how they were
  before this task. Kosmos saves each one's current version first." (the board writes a curly apostrophe), a row per file (`shown`, else `path`) with
  TKU_WHY[action] when ok (a move-aside adds " (savedRoot)"), else TKU_WHY[why] or "left as it is". Checked when ok;
  can be chosen when ok or why is shared, other-task or incomplete; else disabled.
- "Undo the chosen files" POSTs { paths }; none chosen: "Choose at least one file."; a refusal shows the Mac's error or
  "We could not undo that just now."; Cancel repaints (a fresh GET). After: tkUndoDoneLine(out), and the activity is read.
- The route refuses an agent's token; the phone is the person (as for the other actions on this page).

## Call
- A sheet from the link (the list can be long, and it is a choice to make in one place), the board's words and defaults,
  no extra confirmation: the board has none, and each file's current version is saved first.
- Rejected: an inline list in the page (a long list of toggles between the receipt and the message box).
- A plan is only ever of the close on screen: closed again, the offer goes at once (the board's stays until the new receipt).
- The phone says more than the board in two places: no answer or a 5xx (a phone put away mid-undo) is "could not tell", and a 200
  that did nothing and says why is a refusal, not "Undone: 0 files.".
- The list cannot be left while its undo is out (up to 120 s; the board's Cancel can): the answer has nowhere else to show.
- Weakest premise: that a person wants to change files on the computer from the phone. It is off unless Settings' undo
  switch is on, so it shows only to someone who turned it on.

## To build
- TaskPageLogic: taskUndoRequest (GET) and taskUndoApply (POST { paths }), parseUndoPlan, the row words, undoDoneLine; pin
  the words through ios.receipt-words-8958.test.js's pattern (add undo cases to the generated file).
- TaskPageModel: the plan read after a receipt lands (same rules: newest read draws, put-back or leave drops it), undo(paths)
  with one in flight, the refusal line, then a read of the activity; the plan read again on Cancel.
- TaskPageView: the link and done line under receiptBlock, the sheet with a toggle per file (44 pt, its words read with it).
- Declare both routes in server.ios-routes-6838.test.js (SITES' expect list and two entries).
- Tests: LogicTests with every guard mutated red; a UI test on the sample Mac; dark checked with `xcrun simctl ui` (see
  TextSetupUITests), never XCUIDevice.appearance.
