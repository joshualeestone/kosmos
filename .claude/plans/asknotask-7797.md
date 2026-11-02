# asknotask-7797: an agent's question tied to no task, on Tasks (kosmos#7797 item 1)

Card: kosmos#7797, item 1. Proposal posted on the card (comment 6588827142) before building.

## Finished looks like

An agent asking the person a question (roster card `needs_you`, `stateProject` a project or none) is on the Tasks view's
Needs Your Decision even when no open task of that project carries it, on the Mac board and the iPhone app, counted by
the red tile, with one way to answer: Answer opens the agent. A question is never in two places and never lost.

## Built

1. Engine `tasks.askingWithoutTask(rows, roster, scope, projectList, keepArchived)` (engine/tasks.js): the same cards as
   `cardsNeedingPerson`; a question a row already names (`waitingOn`, reason `question`, same agent and project) is left
   out; questions only (a trust wait or lost connection is met on the agent); oldest wait first, unknown starts last;
   the project named as a task row names it; an archived project's question left out unless its door is open.
2. Route: `GET /api/tasks?view=tasks` sends `askingWithoutTask`.
3. Web (web/index.html): rows first in Needs Your Decision ("Max asks about Spring launch" / "Zoe asks you something",
   the wait, Answer opening the agent), tile and heading count them, project scope keeps only its questions, a search or
   Created window leaves them out; grouped by project they lead under "Questions for you"; one card with the decision
   tasks, in both looks.
4. iPhone: TasksLogic.swift reads them (older board: none), sections/tiles count them in Needs you (not Open),
   `askingKept` keeps a question a row in another group took over until the next lay-out; TasksView.swift draws the
   row with Answer (spoken "Answer <agent>"), both Answer buttons a 44pt tap area.
5. Tests: engine/tasks-asknotask-7797.test.js; ios/LogicTests/tasks (live-update cases with controls); browser check
   docs/browser-checks/render-asknotask-7797.js (README row, gated.txt); design-shot screen tasks-asknotask-7797.

## Decided

- A question about a project its agent was taken off is listed once (#5034 keeps the task out of the red; the question
  is still real).
- iPhone live update: never lost over never twice (a moved row may briefly offer Answer beside the kept question).
- A search hides the questions (they are not tasks). Weakest premise: a person searching an agent's name may expect it.

## Left

- Recorded on the card, pre-existing: an archived project's door then All projects without a re-read hides a carried
  question until the next read; the Projects need-you tile reads "Issue" over a card that says "Question".
