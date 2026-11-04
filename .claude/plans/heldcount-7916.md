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
- The iPhone app, agreed with April (kosmos#7918) at 03:2x: this branch carries her first two #7918 commits (the
  phone's project pill and Tasks ask row read held) and the `held` entry in both phone needsWhy maps, which the room
  suite's "the phone words exactly the board's reasons" check requires once PJ_NEEDS_WHY has it. On this branch alone
  the phone's needs notice and task rows still say "Waiting for your answer" for a held question: those map entries
  are read by April's remaining #7918 commits (task rows read waitingOn[].held, the notice reads a member's
  stateHeld), stacked on this branch and merged right after it. heldios-7918.md's line about waitingOn was written
  before round 1 here and is superseded by this paragraph.

- Round 7: the project pill says Question held only when no task waits on the person's decision too (heldForYou),
  on the page and the phone.
- Accepted residual (round 7): a held row the person dismisses on the project page stays dismissed if the agent then
  asks the same words for real, because the dismissal key (projects.needsDismissKey, 'question:' + its words) does not
  include held. Changing the key touches the dismissal route and the phone's own key; recorded on kosmos#7916 as a
  follow-up rather than changed in the last review round.

- Open at the review cap (round 8): Today. cardlabel.reasonOf gives a held question the 'question' reason, so the
  Today card (the page's PJ_NEEDS_WHY via needsReason, and the phone's todayWhy) says "Waiting for your answer" under
  the card word "Question held". Fixing it means a held reason in reasonOf, NEEDS_REASONS and the phone's todayWhy
  together; recorded on kosmos#7916 as the next follow-up.

## Rejected
Leaving a held question out of the counts: while the person is away, the count is where it stays visible.

## Weakest premise
That "Question held" on the project pill is enough without the count changing; a person may still read the count
as pressing.

## Tests (also engine/tasks-waitingon-6157 and web.tasks-look-3559, the task-row cases)
engine/projects.test.js (#7916, real projects.list off recorded reports), engine/tasks-asknotask-7797.test.js
(#7916), web.heldcount-7916.test.js (pjPillOf and tskAskRow lifted from the page), server.answeredq-5943.test.js
(#7916 on-only held note). Seven mutations, all red.
