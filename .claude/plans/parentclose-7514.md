# parentclose-7514: closing a parent can take its built subtasks, when asked

Card: joshualeestone/kosmos#7514 (agent feedback 10-27 and 10-28; Splinter's 16:01 hand-off). Owner: PigeonPete.

## Problem
A coordinator runs rounds as one parent with a subtask per worker. Workers mark subtasks built; closing the parent
closes only the parent, so each finished round's built subtasks stay open (handoff output, board summaries). #6501's
page link closes them in one press, but only for a person on the page; #7412 closes several numbers, but the agent
must list each one.

## Change (opt-in)
- `engine/tasks.js` `close(projectId, n, { replacedBy, withBuilt })`: with `withBuilt`, a plain close of a parent also
  closes its BUILT subtasks (built mark set, not held, not closed, not a repeat the person set), and theirs under them,
  read from one raw snapshot (no claim join) and one tree. Each is re-checked inside its own write (`onlyIfBuilt`, the
  same predicate, the person's repeat included) and records `closed` with `via: 'parent'`. The result carries
  `closedWith`. `wantLeft` (the route asks it) returns `builtLeft` without closing them, so a caller can offer the choice;
  a close that asks for neither reads nothing extra (the bulk route, the Assigner, every other caller). A subtask that
  cannot be closed stops the rest: the parent is closed, and `closedWith` and `builtLeft` say how far it got. A close
  as replaced does neither.
- `server.js` task close route: accepts `{ withBuilt: true }` (a boolean only; refused beside `replacedBy`), and tells
  the closed subtasks' agents, each once, from one roster. The Tasks screen's bulk close is unchanged.
- `install/kosmos` and `tools/windows/kosmos-cli.js`: `kosmos task close <project> <n> [...] --with-built`. They say
  "Its built subtasks closed with it: N, M." or, without the flag, "Its built subtasks are still open: N, M. To close
  them: kosmos task close <project> N M" (the subtasks themselves: re-closing the parent would move its finish time; a
  hint never names a subtask the same command closes). An older board that refuses the flag is said as such. The help
  line and usage name the flag.
- The #3861 doctrine reads "nothing cascades unasked".

## Decided (reasoning on the card)
- First built as a cascade on every parent close; review round 1 showed that skips the person's check: built means
  waiting for the person (#3951), #6421 refused an automatic close of completed children, and #6501 shipped only an
  explicit press. A silent cascade would also have changed the page's and the phone's "Mark as done" without a word.
  So the close is asked for, and a plain close tells the coordinator the command at the moment it matters.
- Rejected: auto-close on built or on parent-ready (#3951); a page action (#6501 has one).
- Weakest premise: coordinators read the close's answer. The hint is printed by both command lines on every parent
  close that leaves built subtasks, which is where a coordinator closing a round will see it.

## Tests
- `engine/tasks.parentclose-7514.test.js`: a plain close takes none and names builtLeft; withBuilt takes only built
  ones (not open, held, or a person's repeat), nested ones too, records via parent; a replaced close takes none and
  offers none; one that stopped being built after the read is left; reopen is per task.
- `cli.task-close-parent-7514.test.js`: the route's plain and withBuilt answers, the telling (each agent once),
  refused bodies, the screen's bulk close taking none, and both command lines (hint, single, several, refusal).
- 17 mutants (engine arms, route, each command line) each turn a test red. #3861's, #3951's and #7412's tests pass.

## Older boards (round 6)
- A close asked `withBuilt` always answers `closedWith` (empty when none went). A board older than #6923 never read
  the body and closes the parent as done; its answer has no `closedWith`, so both commands say the subtasks were not
  closed and exit 1. A board from #6923's first days refused the key as "we could not read that request": both commands
  read that, under --with-built, as older too.
- The phone's own phrase copy (`ios/Kosmos/TaskPageLogic.swift`) reads "Marked done with task N", pinned in
  `ios/LogicTests/taskpage/main.swift`. 10 more mutants (engine, each command line's two new checks, Swift) each red.
