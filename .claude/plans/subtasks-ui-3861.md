# #3861 part 2: subtasks in the Tasks screen (part 1, the data/engine/API/CLI, merged as #3873)

## Finished looks like (Splinter's calls on the card; April reviews; Josh can override)
- The Tasks view (#3559) and the project task list nest subtasks under their parent: indented, collapsible, with a
  progress chip on the parent ("2/5": closed children / children).
- Two levels shown nested; deeper levels flatten under level 2, each with a small breadcrumb naming its parent.
- A child row shows its parent's sentence as a small breadcrumb (also when the parent is filtered out or in another
  group: then the child shows top level with the crumb).
- A task's page lists its subtasks with "+ Add subtask" (creates with parent = this task).
- The New task dialog has an optional "Part of" picker (open tasks in the same project; none by default).
- When every child is closed and the parent is open, the parent says "all subtasks done" and offers Close; closing
  the last child never closes the parent.
- Before and after shots; a browser check render-subtasks-3861.js (wiring: README row, runner list, EXPECTED_SITES
  +2 measured by browser-checks-reason-grep.test.js).

## Where things are (read before building)
- /api/tasks rows carry `parent` (normalized: a missing parent reads null) from engine/tasks.js allTasks; the
  set-parent route and create's `parent` are in server.js (grep "3861").
- The Tasks view painter: grep "#3559" / tskPaint / tskVisible in web/index.html; the project task list: #pj-tasks-field.
- The task page (task detail) and New task dialog: grep "New task" / tskNew in web/index.html.
- April's review notes on #3767: the tile sub-line still says "has not said it started"; keep consistent wording.

## Decided / open
- Weakest premise (Splinter): two visible levels are enough.
- The parent's own activity feed does not log a child being put under it (part 1 review NIT): show "Subtasks" on the
  task page instead of a feed line.

## Built (Mona, 2026-09-25 night) and the calls made while building
- One nesting rule, `taskNest` in web/index.html, used by the Tasks view AND the project column.
  A row nests under its parent only when the parent is in the same list; otherwise it keeps the
  list's own place and says "Part of #N <sentence>".
- DECIDED: the crumb shows only where the indent cannot say it (the parent is not in this list, or
  the row is a third level drawn at the second). The plan's line read as "every child row"; a child
  sitting directly under its parent repeating the parent's sentence is the line above said twice.
  Rejected: crumb on every child. Weakest premise: a long family scrolled so the parent is off the
  top loses the context; if that bites, show the crumb on children too. One-line change in taskNest.
- DECIDED: the fold lives in the Tasks view only (the chip is the toggle, aria-expanded). The
  project column caps at five, so there is nothing to fold there; it nests and shows the chip.
- The chip counts DIRECT subtasks (the engine's rule): a grandchild counts under its own parent.
- engine/projects.js joinTaskClaims now puts `parent`, `parentSentence`, `subtasks` on the project
  page's rows from the same `treeOf` (exported) that /api/tasks rows use; the test pins they agree.
- "all subtasks done" + Close it on the Tasks row (one task through /api/tasks/close); on the task
  page "All subtasks done. Close this task" is the page's own Mark as done.
- Task page: Subtasks list (Open/Done, each opens its page), "Part of" in This task (a way up),
  "+ Add subtask" opens New task with Part of preset (a closed preset is still offered; a closed
  parent is valid). New task's "Part of" defaults to None and lists the project's open tasks.
- EXPECTED_SITES measured: +0, not +2 (the check's PASS/FAIL line is the ternary form the scan does
  not count, and it has no fail loop). Negative control: disabling nesting reds the check.
