# builtcard-6501: a built task on the project page says so

Card: kosmos#6501, item 1 only (Splinter, 13:09: reversible, decide it here, no new controls). Items 2 and 3 stay parked.

## Change
paintProjectTasks: an open task marked built (builtAt, not closed, not on hold) shows "Task N (built)" and, on a line of
its own, "Built, waiting for you to check it" (.tkcard-built, styled as .tkcard-from). Its claim is not shown. Closing
stays on the task's page. Before this, the card did not show built at all, so the task read as unfinished work.

## Tests
web.task-card-761 (#6501: built, nobody assigned, held, CONTROL not built; fails on main); render-tasks (a task marked
built from the page reads "(built)", CONTROL its neighbour does not; on main the built card read "TASK 6 / Nobody yet").

## Status
- [x] Round 1 (opus): WARNING, a held and built task said built (the engine's taskState: hold wins) --> FIXED.
  WARNING, the built line sat under one agent's name, misattributing who marked it --> FIXED: its own line, claim
  dropped. NIT, nobody assigned or no claim showed nothing --> FIXED by the same own line. NIT, the new look hides the
  label --> the own line is visible there. NIT, a misplaced comment --> FIXED.
- [ ] Round 2, shots, validation, proof, PR (merges after the 0.7.57 lift).
