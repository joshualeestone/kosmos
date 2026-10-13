# subpick-3029: name every project picker by its chain (kosmos#3029)

## Done when
Everywhere a person picks or reads a project from a flat list, a subproject is named by its chain
("Book A › Launch") and follows its parent in the order, so it never reads as top-level and two
same-named subprojects under different parents are told apart. A top-level project reads exactly as
before. The places:
- Tasks: the Project: dropdown, the Group by: Project headings, the "All tasks › ..." crumb
- New task from All tasks: the "which project" picker (ntChoices / #nt-proj)
- Project Settings: the parent picker (#pjs-parent)
- Create project: the parent picker (#pj-add-parent)

## Measured first (0.7.44, 7e61d3c43)
Angel's 09-21 inventory holds for every view that SHOWS projects (list indent, grid ancestry line,
consolidated tree, detail breadcrumb, org map). The five places above came after it or were never in
it; all listed bare names. Rendered control: the browser arm below, run against origin/main's page,
shows "Launch", "Launch" in every picker.

## Approach
- engine/tasks.js allTasks: each row gains `projectPath` (ancestor names, root first), from the same
  snapshot it already reads. Same walk as the page's pjAncestry (parentName stands in for a parent
  missing from the read; a stored loop stops). The Tasks screen reads names off rows, not PROJECTS.
- web/index.html: pjChainOf / pjChainCompare / pjChainText beside pjAncestry. Lists sort segment by
  segment, so "Alpha 2" never sits between "Alpha" and "Alpha › Sub".
- The parent pickers switch from the list's sort (PJ_SORT, default newest) to chain order: a picker
  is for finding a project by name, and tree order is what makes a subproject findable.

## Decided
- The chain, not indentation: a closed native select would show an indent with no parent.
- Rejected a custom tree picker: far bigger, and the native select is what keyboards, screen readers
  and the phone picker handle.
- Weakest premise: a long chain is cut off in a narrow select on a phone, losing the tail (the
  project's own name). If shots show it, put the own name first ("Launch, in Book A").

## Tests
- engine/tasks.projectpath-3029.test.js (3), negative control: projectPathOf returning [] fails all 3.
- docs/browser-checks/render-subprojects-1994.js #3029 arm (6 per theme), control on main fails 12/12.
- web.tasks-new-3703.test.js lift list gains the helpers.
