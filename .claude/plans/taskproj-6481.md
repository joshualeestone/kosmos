# taskproj-6481: Tasks rows leave out the project line when every task in view is in one project

Card: kosmos#6481. Shot named on the card: `~/work/design-shots/noise-0756/03-tasks-project-on-every-row-and-group-text.png`.

## Rule

`tskPaint` decides on `scoped`: every task in view, open or closed (Project filter, search and Created window
applied, BEFORE the tile). The title reads the same array (it counts the open ones), so the title and the rows always
agree and a tile never changes either by itself. Open tasks in A plus a closed one in B keep the line ("N Tasks on
1 Project").
- `tskRowsShareOneProject(rows)`: rows non-empty and all with the same, non-empty `projectId`.
- `tskLeaveOutProjectLine(scoped, picked)`: every task in view in one project AND something else names it (the crumb when a project is
  picked, or the title when it counts at least one open task). Pure; `tskPaint` sets `TSK.oneProjectInView` from it,
  and `tskRow` then leaves
  out the `.meta [data-open-project]` button. The rest of the meta line stays.
- `tskTitle(read, picked, scoped)`: the total the tiles break down (open tasks). One preposition, "on": picked
  project by its leaf ("2 Tasks on Launch", the crumb carries the path); no filter and one project by its full path
  ("2 Tasks on Book A › Launch", no crumb); otherwise "N Tasks on M Projects"; 0 open and nothing picked is "0 Tasks".

## Edge cases, decided

- Two or more projects in view: the line and the title as before.
- A task with no project counts as its own project; only such tasks: no change.
- Empty view, or no filter and only closed tasks of one project: "0 Tasks", and the rows keep the line.
- "Part of #N" stays. The checkbox aria-label still names the project.
- Search: `tskMatches` reads `projectName` and `projectPath`, never the drawn line, so a project-name search still
  finds the tasks.
- A repaint that removes a focused project button sends focus to the Project filter (tskFocusRestore's fallback).

## Files

- `web/index.html`: the three functions, the TSK field, the paint wiring, the row.
- `web.tasks-one-project-6481.test.js`: the rule, the title, the line decision, the real `tskRow`, Part of kept, a
  paint order pin (order only).
- `docs/browser-checks/render-tasks-view-3559.js`: two projects (control), the filter on one, a project-name search
  (rows and title), a one-project row at 390. `render-taskhover-4880.js`: a second project so a row has a name to
  click. `web.alltasks-1382.test.js`, the checks README: the title pins.

## Weakest premise

With no Project filter, the row's one-click link to the project is gone: the title names the project but is plain
text, so the way in is the Project filter (then the crumb's Open project) or a task's own page. The name itself stays
on screen. Closed rows have disabled checkboxes, so for a keyboard user there the title names the project only when
the line is left out, which is exactly when the title names it; when the title reads "N Tasks on 1 Project" the
rows keep the line. The enabled checkboxes' labels still say the project.
