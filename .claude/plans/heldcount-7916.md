# heldcount-7916: a held question reads held beyond the agent card (kosmos#7916, follow-up to #7915)

Stacked on heldq-7915 until it merges; then rebased onto origin/main.

## Decided (reversible; my call)
- The project card's pill says "Question held" (calm) when every waiting question in it is held:
  engine/projects.js carries `stateHeld` onto the member (same isNamedOurs gate as stateReportedBy) and counts
  `summary.needsYouHeld`; web/index.html pjPillOf reads it before the plain Question.
- The Tasks page's Needs your decision row says "Held until you are back." with no age, for a held question
  (tasks.askingWithoutTask adds `held: true`, only when true, so every other entry keeps its shape).
- A held question filed with only --on or --owner still gets the "they are back" note, quoting what it is on
  (server.js DM route); an unheld words-less question is unchanged (no note).
- Kept: needsYou, the Dock badge and Today still count a held question (#7915's "nothing is lost").

- Round 1 review: the project page's needs list and a task row that carries the question say held too
  (PJ_NEEDS_WHY.held; waitingOnOf adds `held: true`, only when true); an owner-only held question is quoted as
  "a question for <owner>".
- Not here: the iPhone app (project pill, Tasks rows) needs its own build and LogicTests, so it is kosmos#7918.

## Rejected
Leaving a held question out of the counts: while the person is away, the count is where it stays visible.

## Weakest premise
That "Question held" on the project pill is enough without the count changing; a person may still read the count
as pressing.

## Tests
engine/projects.test.js (#7916, real projects.list off recorded reports), engine/tasks-asknotask-7797.test.js
(#7916), web.heldcount-7916.test.js (pjPillOf and tskAskRow lifted from the page), server.answeredq-5943.test.js
(#7916 on-only held note). Seven mutations, all red.
