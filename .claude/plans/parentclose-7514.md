# parentclose-7514: closing a parent takes its built subtasks

Card: joshualeestone/kosmos#7514 (agent feedback 10-27 and 10-28; Splinter's 16:01 hand-off). Owner: PigeonPete.

## Problem
A coordinator runs rounds as one parent with a subtask per worker. Workers mark subtasks built; closing the parent
closed only the parent, so each finished round's built subtasks stayed open (handoff output, board summaries).
#6501's page link does it in one press, but only for a person on the page; #7412 closes several numbers, but the
agent must list each one.

## Change
- `engine/tasks.js` `close()`: a plain close of a parent also closes its BUILT subtasks (built mark set, not held,
  not closed), recursively, each through `setClosed` so each records its own `closed` line. The result carries
  `closedWith` (the numbers, in order) when any went. Open and held subtasks stay open. A close as replaced takes
  none. The #3861 doctrine comment is narrowed from "nothing cascades" to "nothing unfinished cascades".
- `server.js`: the task close route tells the closed subtasks' agents too; the bulk close route (`/api/tasks/close`)
  returns `closedWith` on the parent's row, counts a subtask that is also listed as already closed, and tells their
  agents.
- `install/kosmos` and `tools/windows/kosmos-cli.js`: a close that took subtasks says "Its built subtasks closed
  with it: N, M." (single) or "Task P's built subtasks closed with it: N, M." (several). An older board sends no
  `closedWith`, so nothing extra is said.

## Decided (reasoning on the card)
- Rejected a `--with-built` flag (every coordinator must learn it; a plain close keeps the clutter), auto-close on
  built or on parent-ready (closing is the explicit "it is live", #3951), and a page action (#6501 has it).
- Weakest premise: coordinators close the parent at the end of a round. If they do not, the next step is the
  prompter telling them that closing a ready parent closes the round.

## Tests
- `engine/tasks.parentclose-7514.test.js`: only built subtasks close; open and held stay; a replaced close takes
  none; nested built ones close; no `closedWith` when none; reopen is per task.
- `cli.task-close-parent-7514.test.js`: both routes answer `closedWith`; the bulk route does not close a listed
  subtask twice; both command lines say it, single and several, and say nothing for a task with none.
- 11 mutants (engine arms, route reporting, each CLI line) each turn a test red. #3861's and #7412's tests pass.
