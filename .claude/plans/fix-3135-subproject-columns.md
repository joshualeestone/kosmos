# Plan: #3135: hierarchical subprojects LIST view wraps into columns (6.68)

## The ask (Josh, 6.68, verbatim via Splinter)
"I really like the hierarchical view of projects when there are subprojects involved; however it
doesn't wrap well and keep everything inside of one page ... it keeps the headline of each project
at 100% width ... I can't even see half of my projects."

## Direction (resolved on issue #3135)
Flow the hierarchical (subprojects) Projects-tab LIST view into RESPONSIVE MULTIPLE COLUMNS, so
headlines are no longer 100% width and far more projects fit on one page. Hierarchy KEPT (indent,
not chips). This is the "wrap into columns" reading, confirmed by Josh's words, not the
compact-denser-vertical reading.

## Surface
`body:not(.consolidated) #pj-list:not(.asgrid)` is the non-consolidated Projects TAB list sub-view.
Each project is a full-width `.pj-row` (CSS grid: name | description | faces | pill) stacked in a
single flex column; depth is a FLAT list related only by `margin-left: calc(--pj-depth * 22px)`.
The panel is `max-width: none` in the tab view (#panel-projects overrides .panel-wide), so the list
has real horizontal room for multiple columns.

## Approach (CSS-only, zero markup change)
1. Put the list container into multi-column flow: `display: block; column-width: 20rem;
   column-gap: 24px`. Multi-column (not a wrapping grid) is deliberate: content flows top-to-bottom
   within a column, so a child sits directly under its parent.
2. Compact each row into a column-width card: title + status on line 1, description then agents
   stacked under (the same shape the existing `@media (max-width:52rem)` collapse uses). This
   overrides the base four-column row grid with higher specificity; the base rule text is left
   verbatim because `web.project-rows.test.js` pins it.
3. Keep a subtree together: `break-inside: avoid` on every row and `break-before: avoid` on `.child`
   rows. Since only depth>0 rows carry `.child`, a column break can fall only BEFORE a top-level
   row, never inside a subtree, so no child is orphaned at a column top with no parent above it.
4. Indent (`--pj-depth * 22px`) and the ancestry-chip fallback are UNCHANGED, so depth still reads
   inside a subtree group.

Scoped strictly to `body:not(.consolidated) #pj-list:not(.asgrid)`, so the consolidated rail, the
grid tile view, drag and fold are all untouched.

## Why this reading (weakest premise, resolved)
Weakest premise was whether "wrap into columns" is right at all vs. denser vertical rows. Resolved
by Josh's exact words ("headline at 100% width", "everything inside one page" = more per row). The
orphaned-subtree-across-column risk is mitigated in code by the break rules above.

## Verification
- New browser-check `docs/browser-checks/render-subproject-columns-3135.js` (+ README row): asserts
  the list is columnised, a wide page shows >1 column, `.child` carries break-before:avoid, every
  row break-inside:avoid, rows are compact cards, indent unchanged, and the narrow-page single-column
  control. Each arm returns the dangerous answer on origin/main.
- Existing `render-subprojects-1994.js` (122 pass) and `render-project-rows.js` (all pass) confirmed
  unaffected. `web.project-rows.test.js` + siblings (14 pass) confirm the pinned base rules intact.
- Both browser-check gate libs pass (coarse + surface).
- No browser this session (night-shift bot has no claude-fe/Playwright): pixel appearance verified
  structurally via CI browser-checks; Josh eyeballs in-app. Same path #3123/#3126 took.

## Notes
- Kosmos has NO human reviewer (repo CLAUDE.md): the converged challenge-loop is the gate.
- Shared file web/index.html: coordinate merge staggering with Mona (consolidated cards #3127/#3128),
  though this change is disjoint (list rendering vs consolidated rail).
