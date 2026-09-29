# consolnav2-4377: the consolidated nav's Projects loads the full projects page (kosmos#4377, #4345 slice 2)

Josh on #4345: "you could see your full projects and you could sort it in different ways". Stacked on
consolnav-4345 (slice 1). #4345 stays open until this lands.

## Change
- `#panel-cons-projects` in the display column: a Projects title, a sort select forwarding to `#pj-sort`
  (one sort, one stored preference, one repaint path), and `#pj-full-list` (`.pj-list.asgrid`) painted
  by `paintConsProjects()` with `pjTreeRows` over the same sorted list `paintProjects` uses, from every
  `paintProjects` exit and from the projects read's failure path (empty / failed reads show the rail's
  own sentence).
- A row click is `openProject`, the rail's own action: the project becomes active, never a nested view.
- Nav: Projects opens the page; pressed again, or any project opened, returns to the board. The board
  lights no nav item, so a lit Projects always means the page is open.
- The rail's 25 unscoped consolidated `.pj-row` / `.pjcard-h b` rules now read
  `body.consolidated :where(#pj-list) ...`. `:where` adds zero specificity, so the rail's cascade is
  unchanged. Measured: computed styles of all 120 rail elements, 2 widths x 2 themes, identical to
  slice 1; positive control, one rule pointed at `#nope`: 40 differences.

## Decided
- Grid only, not the Roadmap: the rail beside it already is the tree, so the grid is the non-redundant
  view. Josh can override.
- The board lights nothing (slice 1 lit Projects for it); otherwise the second press that returns to the
  board would be invisible.

## Weakest premise
That "press Projects again" is discoverable enough as the way back. Opening any project also returns,
and the rail's projects are always on screen.

## Tests
render-consolidated-nav-4345.js extended to 78 checks: rows and grid look vs rail, the shared sort, row
click, empty and failed reads, the poll's hint repaint (with a board control), Settings and the tab
layout closing it. 10 mutants, all killed (two first survived on test-state gaps, fixed).

## Review round 1 (opus, blind): 0 BLOCKER, 2 WARNING, 5 NIT
- WARNING (reproduced) a stray fold caret on every parent tile in the copy: the hide rule was `#pj-list`
  only. Now `#pj-list .pjtreefold, #pj-full-list .pjtreefold`. FIXED.
- WARNING (reproduced) the copy's sort select had no chevron (.sortctl select is appearance:none). The
  chevron beside #pj-sort is copied with it. FIXED.
- NIT the parent chip was left-aligned in the copy (an unscoped `body.consolidated .pj-anc`). Scoped to
  `:where(#pj-list)` like the other rail rules; rail diff re-run: 120 elements, 0 differences. FIXED.
- NIT a duplicate `#pj-new-empty` from the copied empty state: the copy carries `data-pj-new-empty`. FIXED.
- NIT two rows with aria-current: the copy never marks the open project. FIXED.
- NIT `res.nested` could not fail: deleted (`res.clicked` is the real no-nesting assertion).
- NIT during a drag the copy can run ahead of the rail until the drag ends: KEPT. The copy is the correct
  one, and pausing it too would copy the drag pause into a view with no drag.
- Check 78 -> 88; the five fixes each mutation-checked.

## Final validation (6j), first run: FAILED on seven tests, all mine
- `web.board-empty`: it finds the empty-state button by the first `id="pj-new-empty"` in the script, and
  my copy's regex literal came first. The copy's fix-ups now run on the nodes after the write (remove
  aria-current; swap the duplicate id for data-pj-new-empty), so no literal is left and it is sturdier.
- `web.projects-signed-out-718`: it lifts loadProjects with stubbed collaborators, and the new
  paintConsProjects() call in the failure path had none. Stub added.
- `web.consolidated-774`, `web.consolidated-980`, and the #1469 brace-anchor guard (its EXPECTED table
  plus two selftests): pins on selectors this branch rescoped or extended. Updated to the new
  spelling; each still fails on the old code.
- The whole web.* suite then ran clean: 2026 of 2026.
