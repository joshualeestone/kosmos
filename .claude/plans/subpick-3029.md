# subpick-3029: name every project picker by its chain (kosmos#3029)

## Done when
Everywhere a person picks or reads a project from a flat list, a subproject is named by its chain
("Book A › Launch") and follows its parent in the order, so it never reads as top-level and two
same-named subprojects under different parents are told apart. A top-level project reads exactly as
before. The places:
- Tasks: the Project: dropdown, the Group by: Project headings, the "All tasks › ..." crumb, the
  back chevron's label, each row's project button (Group by: Status), the
  row checkbox and "Not built yet" labels, the bulk-close failure line, and search
- Accessible names (aria-labels) join the chain with commas ("Book A, Launch"), not the › mark
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
  snapshot it already reads. A parent missing from the read gives [] (tested); a stored loop stops.
  The Tasks screen reads names off rows, not PROJECTS.
- web/index.html: pjChainOf / pjChainCompare / pjChainText beside pjAncestry. Lists sort segment by
  segment, so a sibling like "Alpha - old" never sits between "Alpha" and "Alpha › Sub" (a joined
  localeCompare sort does put it there; "Alpha 2" would NOT have shown it, measured).
- The parent pickers switch from the list's sort (PJ_SORT, default newest) to chain order: a picker
  is for finding a project by name, and tree order is what makes a subproject findable.

## Decided
- Tasks search matches a row's ancestors too, so searching a parent's name finds its subprojects'
  tasks: the chain is what the row shows, so it is what search reads.
- The chain, not indentation: a closed native select would show an indent with no parent.
- The "N Tasks on ..." title keeps the picked project's own name: the shots showed the chain repeated there
  as a four-line heading right under the crumb that already shows it. The crumb is the path.
- The Tasks dropdowns are capped at 22rem: a whole-chain option stretched the Project dropdown across most
  of a desktop row.
- Select options read own name first ("Launch, in Book A") so a cut-short closed select still says which
  project is picked; everything that is not a select reads the chain root first.
- Rejected a custom tree picker: far bigger, and the native select is what keyboards, screen readers
  and the phone picker handle.
- Weakest premise (it came true, see below): a long chain is cut off in a narrow select on a phone, losing the tail (the project's own name).
  Done: select options read own name first ("Launch, in Book A").

## Tests
  It happened. At 390 px a picked long chain is cut short in the closed select in Chromium (ellipsis) and
  WebKit (hard clip), and the part lost was the project's own name. So every select option is worded own
  name first ("Launch, in Book A"), still ordered by the chain; headings, crumb, title and rows keep the
  chain. WebKit (the Mac app's engine) also scrolled the page 140 px sideways by the picked option's text
  even with the select capped; overflow: hidden on the select fixes it. The browser arm runs the picked
  long-chain fit check in Chromium and in WebKit (without the fix WebKit fails: a 1653 px page at 390).
  Design shots: ~/work/design-shots/kosmos-3029/ (tasks-subprojects, tasks-subproject-picked; desktop and
  iPhone 15, light and dark, Chromium and WebKit), taken from the branch's own mobile-shots.js screens.
- engine/tasks.projectpath-3029.test.js: the engine walk, with a negative control (projectPathOf returning
  [] fails every test).
- web.subpick-3029.test.js: the shipped page helpers; its control shows a joined-string sort misorders
  "Alpha - old", and a mutant compare fails it.
- docs/browser-checks/render-subprojects-1994.js, the #3029 arm: every surface above, light and dark,
  through the page's own painters. Run against origin/main's page, every #3029 assertion fails.
- Lift lists gain the helpers in web.tasks-new-3703, web.task-repeat-4787, web.subtasks-3861 and
  web.tasks-look-3559.

## Surface gate (#2518)
The final validation's surface gate named three checks whose surface tokens appear on changed lines.
None is affected, and the commit carrying this note says why per check:
- render-subback-4586.js (tsk-crumb-open): the crumb now shows the chain, which for a top-level
  project is exactly its name; that check's projects are all top-level (no parent in its fixtures).
- render-allagents-4812.js and render-phone-offline-718.js (grid): the token appears only in a
  comment ("the grid's ancestry line"), not in any markup or rule.
