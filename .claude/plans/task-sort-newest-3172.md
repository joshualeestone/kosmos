# task-sort-newest-3172: newest task on top in the project task column

**Card:** #3172 (Josh, 2026-09-16). On project pages (tab view OR consolidated view)
the tasks sort by the first task ever created, i.e. oldest first, which is the one
most likely already done. Josh wants the most recent task on top.

## What this ships
- `paintProjectTasks()` (web/index.html) sorts the open-task `column` by task number
  DESC (newest-created on top) BEFORE the five-item cap, so the column shows the
  newest five with the newest on top.

## Why here, and why before the cap (the crux)
- The tab view and the consolidated view share ONE render (`paintProjectTasks` ->
  `#pj-tasklist`); "consolidated" is only a CSS layout mode, not a separate render.
  So one sort covers both views. (Confirmed independently with Angel, who owns the
  consolidated view; his part is a verified no-op.)
- The column caps at `TK_COLUMN_MAX = 5` via `column.slice(0, 5)`. The data arrives
  in creation order (oldest first), so a sort placed AFTER the slice would reorder
  only the five already-showing and still hide the newest behind the five oldest,
  which IS Josh's complaint. The sort therefore runs before the slice.

## Sort key
- `Number(b.number) - Number(a.number)` (task number DESC). The number is
  server-issued and monotonic, so it is the robust newest-created proxy; `createdAt`
  can be null on older tasks.

## Weakest premise (decided, reversible)
- "Most recent" is read as most-recently-CREATED (task number DESC). I put the
  created-vs-most-recently-worked question to Josh and am proceeding with created as
  the default rather than blocking. If he means most-recently-worked, it is a
  one-line key change (sort by `movedAt`/activity instead of number), same location.

## Not in scope (and a residual to flag to Josh)
- The All-tasks index screen (`#alltasks-list`, `openAllTasksView`) is a SEPARATE
  render. Josh's #3172 wording is explicitly the project-page column ("on project
  pages, either in the tab view or the consolidated view"), so this change is
  confined to `paintProjectTasks`.
- Precise about the residual, because the earlier justification here was not:
  the index is NOT already newest-first. #3171 added open-before-closed grouping
  and the Open/Closed pills, but WITHIN the open group the index still shows tasks
  oldest-first, because `allTasks()` sorts `(isClosed) ASC, then number ASC`
  (engine/tasks.js). So the View-All screen reproduces the same oldest-on-top
  behavior for open tasks that #3172 fixes on the column. That is a deliberate,
  reversible scope call (Josh asked for the project column, not the index), and it
  is being flagged to Josh alongside the created-vs-worked question: should View
  All match the column's newest-first direction? If yes, it is a one-line key
  change in `allTasks()` (add `number DESC` as the within-group tiebreak), and
  #3171's browser-check still holds (it pins open-above-closed, not within-group
  order).

## Verification
- `render-tasks.js` browser-check: updated for the newest-first order (the newer of
  the two fixture tasks is on top; who-chips re-mapped to their new positions; the
  task-page click targets the assigned task by its says-line rather than by column
  position), PLUS a new 6-task cap test that asserts the column shows the newest five
  (6..2) with the oldest (task 1) hidden -- the assertion that fails if the sort ran
  after the slice. Negative-control verified (disabling the sort fails the check).
