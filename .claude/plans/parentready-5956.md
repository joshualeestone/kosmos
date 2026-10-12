# parentready-5956: parent ready when its subtasks are built; done-when at creation (kosmos#5956)

## Done when
1. A parent whose direct subtasks are each closed or built (at least one only built) says so: the task list row
   "all subtasks built, ready for you to check" (no Close: the built ones are still open), the project card chip
   ", all subtasks built", and the task page "All subtasks are built. Check each one and close it, then close this task.",
   with each built subtask marked Built. All closed keeps today's "all subtasks done" and Close.
2. The New task dialog asks "How will you know it is done?" and Create stays down until it is filled; the answer
   is sent as the task's first done-when check. Agents and the CLI keep done-when optional.

## Decided (written on the card)
- "Accepted" = built. Marking built already asks the agent to answer each done-when check; Kosmos stores
  answers, not a pass or fail per check. Weakest premise: the reporter may have meant an explicit pass.
- Part 3 (warn before assigning a non-member) is not built here: every picker in the app offers members only, so
  a person cannot make that mistake in the UI. The real path is the agent CLI/API (resolveWhoAsked accepts any
  name), which is engine/CLI work and changes every scripted caller's behaviour; filed as a follow-up.
- "Lacks a capability": Kosmos has no capability model to check against; not built.

- Consequence, intended: every task made in the app now carries a done-when, and an agent's `kosmos task built`
  with no note is refused on a task with one (#5705). That is the point: the agent answers what done means. Said on
  the card so agents and the person know.
- A built subtask the person put on hold reads held, not built (review 1), as taskState already ranks it.

## Approach
- engine/tasks.js treeOf progress: adds `built` (open children with builtAt).
- web/index.html: tskRow and the project card read `built`; tkPaintSubtasks marks Built and shows #tk-subs-built;
  the New task dialog gains #nt-done, the Create gate (ntGoState) and the body's doneWhen.
- Browser checks that create a task through the dialog fill #nt-done; render-tasks asserts the gate.

## Not mine
- server.subtasks-3861.test.js: 3 Mac `task add` failures, identical on origin/main (kosmos#5933).
