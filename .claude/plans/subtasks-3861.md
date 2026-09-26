# #3861: tasks can have a parent (subtasks)

Josh, 2026-09-25 20:20 CDT in #admin: "Let's add something to tasks so they can have a parent".
Splinter's build calls are on the card. Owner: April. Two PRs.

## PR 1 (this branch, subtasks-3861): engine, API, CLI, doctrine

- engine/tasks.js
  - `parent` on a task: a task number on the SAME project, or null. Stored as a bare number, so a
    cross-project parent has no spelling.
  - `parentProblem(p, n, parent)`: refuses a non-number, a task that is not on this project, the
    task itself, and a loop at any depth (walks up from the proposed parent; bounded by a seen set
    so a hand-edited loop cannot hang it).
  - `create(..., { parent })` validates inside the same `projects.mutate` that stores the task.
  - `setParent(projectId, n, parent|null)` validates inside its write; records `parent-set` /
    `parent-cleared` in the task transcript; a no-op records nothing.
  - `parentOf` (a dangling or self parent reads as null), `childrenOf`, `subtaskProgress` (direct
    children only, so a grandchild is never counted twice).
  - `allTasks` rows gain `parent`, `parentSentence`, `subtasks: {done, total}`.
  - Nothing cascades: closing a parent leaves its children open; closing the last child leaves the
    parent open (the screen will offer Close in PR 2).
- server.js: `POST /api/project/:id/tasks` passes `parent`; new `POST /api/project/:id/task/:n/parent`
  with `{ parent: n | null }` (400 refusal, 404 missing task/project).
- install/kosmos and tools/windows/kosmos-cli.js: `kosmos task add <project> "<sentence>" [detail]
  --parent <n>`; `task list` shows "(under task N)" and "[d/t subtasks done]".
  - Decision: the card says `task new --parent`; the existing verb is `task add`, so the flag goes
    on `add` rather than adding a second verb for the same act.
  - Decision: Windows parity implemented directly instead of a Homer spec; it is the same small JS.
- engine/projects.js blockBody: one taught line per project: big work is one task with its pieces
  under it via `--parent`.

## Decisions from review

- A closed task is a valid parent (nothing cascades; a follow-up can be filed under finished work).
- The /parent route has no rate valve, like /due: it pages nobody and a same-value write records
  nothing.
- allTasks indexes each project once (number -> task, parent -> children) so rows stay linear.
- The task page's activity list phrases parent-set / parent-cleared / created-under (in this PR,
  since the engine starts recording them here).
- `--parent=N` is refused on both CLIs; the Mac strips leading zeros so it says what Windows says.

## PR 2 (next branch): the Tasks view UI

Nested rows (two visible levels, deeper flatten under level 2 with a breadcrumb), a progress chip,
"+ Add subtask" on the task page, a "Part of" picker in New task, a breadcrumb on child rows,
"all subtasks done" + Close offer on the parent. Mona reviews the look.

## Weakest premise

That direct-children counting is what a person expects from "2/5" on a parent with grandchildren.

## Tests

engine/tasks.subtasks-3861.test.js, server.subtasks-3861.test.js (route, Windows CLI, Mac CLI).
Nine mutations run red.
