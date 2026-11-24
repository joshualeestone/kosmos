# taskreview-8958: who is told when a run is missed, on the iPhone's task page (kosmos#8958 slice B3b)

## Goal
Slice B3b of kosmos#8958: the board's "If missed, tell" choice (tk-review-who, kosmos#4787 slice 3), natively.
Stacked on B3 (taskrepeat-8958); rebased onto main once B1, B2 and B3 merge.

## Call
- The choice shows only on an open task whose rule is STORED (not merely chosen), as on the board. Options: Nobody, Me,
  the project's agents in the project's order, and a stored reviewer who has left the project, listed with
  " (left the project)" so the choice never shows something that is not stored. Saved on change, as the board's.
- Rejected: a Save button (the board saves on change; two different save gestures for one section would confuse).
- Weakest premise: the names come from the projects read's members (the board uses the board-wide roster), so an agent
  with no name on the project shows its roster name or session name, which can differ from the board's label.

## Change
- TaskPageLogic: TaskPage.repeatReviewer ("none", "me" or a session name, the board's tkReviewerOf) and memberOrder;
  Board.reviewerOptions (tkPaintReviewer's list); taskReviewerRequest, POST .../repeat {reviewer} through taskPost.
- TaskPageModel.saveReviewer: nothing for the stored reviewer, while one is out, while a Repeats save or Mark as done
  is out, on a finished task or a task that does not repeat. Refusal: the Mac's sentence. Then page and activity
  are read and "Saved." said, retired when the stored reviewer reads as something else or the task finishes.
- TaskPageView: the "If missed, tell" menu under the repeat line; the choice shown is the stored one, or the one
  being saved while it is out.

## Review decisions
- A reviewer the Mac recorded when the read after it failed stays shown (reviewerShown) until a read of the page
  succeeds, as the Repeats controls keep what was saved; the board instead repaints from its stale read.
- The visible "If missed, tell" is hidden from VoiceOver; the menu's label says it.

## Tests
- ios/LogicTests/taskpage: B3b section and b3bModelTests, 311/311 with B3's. Every guard and the shown-after-a-failed-read
  line go red when removed.
