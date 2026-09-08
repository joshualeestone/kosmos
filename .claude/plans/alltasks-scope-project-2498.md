# Plan: scope the project view's "view all tasks" to the current project (kosmos#2498)

## Problem

Ben found in 0.6.48 testing (Josh 2026-09-08): in a PROJECT view, clicking "view all tasks"
shows tasks across ALL projects instead of only the current project's. Josh, verbatim: "if you're
in a project view and you click to view all tasks, it should just show you all of the tasks for
just that specific project."

## Root cause (code-verified on origin/main)

`web/index.html` `openAllTasksView()` is reached only from `#pj-alltasks`, the per-project door
(the comment at the entry point calls it exactly that). It fetches the GLOBAL `/api/tasks`, whose
route (`server.js`) returns `tasks.allTasks()` - every project's tasks, tagged with projectId /
projectName. It never carries the current project (`PJ_CURRENT`). So the per-project door renders
the global set.

## A standing-ruling conflict I am resolving, not silently overriding (see [[feedback-a-design-mock-can-conflict-with-a-standing-code-ruling]])

The original #1382 ruling made this screen DELIBERATELY global: "this screen shows EVERY project,"
its stated purpose being to surface FINISHED (closed) tasks everywhere that #1009's per-project
column (open tasks only) omits - "Taking the door without taking its contents would leave finished
work unreachable anywhere in Kosmos." It also deliberately put NO count on the door's label ("The
door sits on ONE project and this screen shows EVERY project, so a per-project number could only
disagree with its destination" - the #1346 defect).

Josh's #2498 is a fresh OPERATOR ruling updating his own earlier #1382 design: the per-project door
should scope to the current project. Newest operator word wins, but I preserve #1382's concerns:

- **Finished-work reachability (the reason the door exists):** PRESERVED, now per-project. The
  scoped view still includes CLOSED tasks (allTasks tags isClosed and the filter keeps them), so
  each project's door reveals that project's finished work. Finished work is still reachable
  everywhere - per project rather than in one global list. It is NOT made unreachable.
- **The no-count-on-the-door rule (#1346):** left UNTOUCHED. Scoping the destination would now let
  a per-project count agree with it, but adding a count is a separate enhancement and scope creep;
  the door label stays countless.

The card itself flags this: "check whether there's a legitimate 'all tasks everywhere' view
elsewhere ... not to break the global view if one is intended." Code-verified: `#pj-alltasks` is
the ONLY entry to `openAllTasksView`, and `openAllTasksView` is the ONLY caller of `/api/tasks`.
There is NO separate global/home all-tasks view. So scoping the door breaks nothing else.

## Approach

- **Server (`/api/tasks`):** accept an optional `?project=<id>` query param (read the same way the
  other routes do, `new URL(req.url, ROUTING_BASE).searchParams`). When present, filter
  `tasks.allTasks()` to `t.projectId === id` (open AND closed for that project). No param = global
  set, unchanged (backward-compatible; a future global-home view could still use it). This carries
  and filters on the project rather than fetching the global set, per Josh's own note.
- **Frontend (`openAllTasksView`):** fetch `/api/tasks?project=<encodeURIComponent(PJ_CURRENT)>`,
  and update the now-false copy: the desc "Across every project." -> a project-scoped sentence; the
  empty message "No tasks on any project yet" -> "on this project"; and the click-handler comment
  that says "this screen crosses projects" (the per-row project switch becomes a safe no-op for
  same-project rows and stays as defence).
- **Tests (route level):** `/api/tasks?project=X` returns only X's tasks INCLUDING closed ones
  (the #1382 finished-work purpose, per-project); `/api/tasks` with no param still returns all
  (backward-compat); a non-existent project id returns an empty list. The engine `allTasks()` is
  unchanged, so its #1382 tests keep passing.

## Weakest premise

That Josh wants the per-project door scoped AND does not separately want a global "everywhere"
list to still exist. Mitigation: there is no global view today (only this door), the card
explicitly says to scope the entry point rather than break a global view, and the global route
path is left intact so a future global-home view is a one-line reuse. If Josh later wants both, a
separate global entry point reusing the unscoped `/api/tasks` is additive.
