# #2929 (slice 1): consolidated view as an openable file-structure tree

Source: Josh, 6.59 QA notes 2026-09-12. "show them as an almost openable file
structure, where I have a top-level project and it's showing the subproject and
any third-level projects. I could open and close those." (Card also asks for
draggable clusters to reorder; that is slice 2, see below.)

## The call

Turn the consolidated projects rail into an openable file tree: indent each row by
its tree depth, put a fold caret on every parent, and collapse a parent's whole
subtree when folded. This supersedes, for the consolidated view only, the earlier
decision (#1994/#2487) that the narrow rail carries nesting via an ancestry chip
rather than indent, on the ground that indent "runs out of room by depth three."
Josh's newer QA note asks for exactly the indent-and-fold the chip was chosen over,
so the newer instruction wins for this view.

## What I reused (not built new)

- Projects already nest via `p.parent`; `pjTreeRows` already emits rows in tree
  order with a `--pj-depth` custom property per row; `pjDescendantIds` already walks
  a whole branch. So the tree half is a presentation change, not a data-model one.
- The Map view (#2458) proves the fold pattern (a caret, a fold Set, a click
  delegate that checks the fold handle before the open handle). I mirrored that
  shape rather than inventing one.

## Decisions and what I rejected

1. **Separate fold state (`PJ_TREE_FOLDED`), not shared with the Map's
   `PJ_MAP_FOLDED`.** Rejected sharing: it would couple two views so folding a
   branch in one silently reshapes the other, and it widens the blast radius onto
   the Map. Independent is a tighter slice. Weakest premise: a user might expect
   the two tree views to fold in lockstep. If Josh wants that, unifying the two
   sets is a one-line change later.

2. **Scope everything to the consolidated view; leave the shared `#pj-list` markup
   safe for the tab list and grid.** The same rows serve all three surfaces. The
   caret is CSS-hidden outside the rail; `aria-expanded` is added per-view in
   `applyConsFold` (never in the flat list/grid, which cannot fold); the
   folded-descendant hide is CSS-scoped to the rail. So a consolidated fold never
   hides a row in the wide list, whose rows have no reachable disclosure to bring
   them back. Rejected: baking fold state into the rendered HTML for all views
   (would reshape the tab list) and restructuring `.pj-row` from a button into a
   wrapper+buttons (ripples through grid/list/consolidated layouts, too risky).

3. **Caret is a decorative aria-hidden span inside the row button; the row carries
   `aria-expanded`; keyboard fold is Right/Left arrows (the ARIA tree convention).**
   Rejected a nested `<button>` (invalid inside the row button) and a focusable
   `role=button` span (nested-interactive antipattern). Enter/Space keep opening
   the project (its primary action).

4. **Indent step 14px, base 24px (depth 0/1/2 = 24/38/52px), growing with the true
   depth (no cap).** Rejected the wide list's 22px step: too much for the narrow
   rail at depth 3. The indent is NOT capped: `--pj-depth` carries the real depth
   and a deeper-than-3 tree keeps widening (66px, 80px, ...). That is acceptable
   because the rail name is already ellipsised, so it truncates rather than the
   indent starving it, which is the tradeoff Josh's "third-level" ask implies.
   Tunable if he finds it tight in review.

5. **Hide the ancestry chip on `.child` rows in the rail** (the indent now carries
   the relationship), mirroring the wide-list rule exactly; a dangling-parent child
   at depth 0 keeps its chip so the relationship is never silently lost.

6. **Fold state is session-only (module-level, not persisted), matching the Map
   view.** Josh did not ask for it to survive a restart. Persisting later is easy
   if wanted.

## Verification

New browser-check `render-cons-tree-2929.js` (file://, headless): indent-by-depth
(computed values, so a calc typo reds), caret on parents not leaves,
`aria-expanded` per-view, per-parent fold, keyboard fold, and the consolidated-only
control (in the tab layout the caret is hidden and a fold hides nothing). Both
themes. Registered in `tools/browser-checks.sh`, the README index, and its own
surface decl. Sibling checks (render-subprojects-1994, render-projects-map,
render-project-rows, render-pjadd-back-2850) re-run green, no regression.
I did not drive Playwright against the live app (bot session has no Playwright MCP);
Josh reviews live.

## Slice 2 (not in this PR): draggable clusters to reorder

Depends on this tree existing. Needs a NEW order store: nothing persists project
order today (only a sort MODE in localStorage). Plan: a client-side manual order in
localStorage, mirroring `kosmos.sort.projects`, rather than a new server endpoint
(that is Angel's lane and a bigger change). Weakest premise there: a client-only
order does not sync across devices, acceptable for a local-first single-user app.
