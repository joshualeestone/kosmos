# cons-newagent-display-3053: New Agent opens in the consolidated display area (#3053)

Branch: `cons-newagent-display-3053`  ·  Card: #3053 (josh-review, 6.63 list)  ·  Owner: Mona Lisa
Directed by Splinter (PM) as in-lane; decided + built per Josh's standing "make the call, it's reversible" ruling.

## The report (Josh, 6.63)
In the consolidated view, clicking New Agent takes you back to the tab-view create screen instead of
opening it in the consolidated display area. Sibling of #2842, which fixed the same class for Settings.

## Done condition
Clicking New Agent from the consolidated view opens the create form IN the display column (beside the
projects list), staying in the consolidated layout. A reader on the floor... n/a. Leaving create (project
nav / back / done) returns to the consolidated projects view. Tab view keeps its full-page create. No
"No projects yet" hint renders over the create panel. Verified headless + node suites; Josh confirms on 6.65+.

## Root cause
`openCreate()` calls `showTab('create')`. `showTab` sets `body.consolidated` only for the agents/projects
tabs, so 'create' drops body.consolidated and renders the tab-view create panel -- the kick-out.

## The fix (mirrors #2842 settings-in-consolidated, 5 JS sites + 1 CSS)
- `placeCreatePanel(consolidated)` (mirror `placeAppSettings`): relocate `#panel-create` into
  `#panel-projects` when consolidated (cached `CREATE_PANEL_HOME` restore anchor), restore to top level
  in the tab view.
- `openConsolidatedCreate()` (mirror `openConsolidatedSettings`): while `body.consolidated`, place the
  panel, hide the pj-*-views except `pj-list-view`, hide `#pj-none`, show `#panel-create` -- NO showTab.
- showTab chokepoint: `placeCreatePanel(cons)` beside `placeAppSettings(cons)`.
- `openCreate`: branch the show -- `if (body.consolidated) openConsolidatedCreate(); else showTab('create')`.
- `pjView`: hide the relocated `#panel-create` on project navigation (the exit path -- create-back /
  done route through showTab('agents') -> pjView).
- `paintPjNone`: add `appCreateOpen` so the "No projects yet" hint stays suppressed while create is open
  (the 5s poll re-invokes it).
- CSS: `#panel-projects > #panel-create` in the consolidated layout gets `grid-column:2; margin:0;
  width:100%` (capped by its 34rem max-width) so it sits at the top-LEFT of the display column at its
  form width, overriding the tab-view `margin:0 auto` that collapsed it to a ~193px centered island.

## Rejected
- Full-width fill (like settings): a create FORM at ~900px stretches its fields awkwardly. Kept the 34rem
  form width, left-aligned. (The browser-check asserts the form-width range, not a full fill.)
- Duplicating openCreate's form-reset into openConsolidatedCreate: instead openCreate does the reset once
  and only the SHOW step branches, so the two entry paths cannot diverge on reset.

## Weakest premise
That routing create-back / done through pjView (which now hides the relocated panel) is sufficient for
every exit. The browser-check drives the project-nav exit and the leaving-consolidated restore; if a
specific exit (e.g. a future done-flow that bypasses pjView) is found to strand the panel, that is a
scoped follow-up. Also: the create form is left-aligned at 34rem; if Josh prefers it centered or wider in
the column, that is a one-line CSS follow-up.

## Tests
- NEW `docs/browser-checks/render-consolidated-newagent-3053.js` (mirror of render-consolidated-settings-2842.js):
  showTab relocates the panel; New Agent stays consolidated; opens visible in the display column on the
  role step; projects list stays; fills-to-form-width-left-aligned (range check, guards the CSS fix that
  caught the 193px bug); project-nav hides it + shows the project; leaving consolidated restores to top
  level; tab-view CONTROL (not consolidated, full-page create); list-state #pj-none suppression + poll
  re-invoke; agents-tab reachability. 24 assertions, both themes, headless.
- `web.consolidated-774.test.js`: source-grep for the paintPjNone `show` line updated to include
  `&& !appCreateOpen`.
- Full run: web.*.test.js 1429/1429; server.test.js 297/297; #1720 + #2518 browser-check gates exit 0.
