# Plan: #2929 slice 2, drag a project cluster to reorder (consolidated view)

Branch: cluster-reorder-2929. Repo: joshualeestone/kosmos. Author: Mona Lisa.

## Goal
Josh, 6.59 QA notes: "Let's also make them draggable. If for some reason a project's at the very bottom or I have to scroll down to find it, I could actually click on that whole cluster and drag it up to the very top." Slice 1 (openable file-structure tree) shipped in PR #2994. This is slice 2, per the build plan in the #2929 09:37 comment.

## Mechanism (CSS-only-adjacent JS in web/index.html, consolidated-scoped)
- `PJ_ORDER`: a module-level manual top-level order (array of top-level project ids), loaded from / saved to `localStorage['kosmos.order.projects']` the same way the sort setting is (a display preference). `null` = no manual order in effect. Helpers `pjSaveOrder` / `pjClearOrder`.
- `pjTreeRows`: when `PJ_ORDER` is set AND `body.consolidated`, reorder only the TOP-LEVEL clusters (`kids.get('')`) by `PJ_ORDER` (non-mutating decorated sort; ids not listed keep their sorted position after, so a new project is never hidden). Subprojects keep their sorted order because the child arrays are never touched.
- `wirePjClusterDrag`: delegated ONCE on `#pj-list` (survives the ~5s repaint), consolidated-gated. Only top-level rows are `draggable` (set in `applyConsFold`; the row is itself the card button, so drag vs click is gesture-distinguished). On drop, the new top-level id order is read from the rendered rows, the dragged id moved before/after the target by pointer half, saved as `PJ_ORDER`, repainted.
- Mutual exclusion: dragging SETS the manual order; the `#pj-sort` change handler CLEARS it (`pjClearOrder`). Last action wins.
- Scope: consolidated view only (the reorder in `pjTreeRows` and the `draggable` in `applyConsFold` are both gated on `body.consolidated`); the tab list and grid keep the sort order. Keyboard ordering stays on the sort dropdown (drag is a pointer affordance, no keyboard trap).

## Verification
New headless browser-check `docs/browser-checks/render-cluster-reorder-2929.js` (registered in tools/browser-checks.sh, README index, in-file surface decl): dispatches HTML5 DragEvents with a shared DataTransfer (Playwright's mouse-drag does not fire native drag events) against a real fixture tree (a,b,c + a1 under a). Asserts pre-drag sorted order + only-top-level-draggable; drag Charlie to the top -> c,a,b with a1 still under a; persistence to localStorage + PJ_ORDER; a sort choice clears the manual order and reverts; and the tab view ignores PJ_ORDER (scoping). Both themes; also a self-drop no-op, the lower-half "insert after" (+1) branch / drag-to-last, a cancelled drag, and the stranded-flag self-heal. 38/38 pass. A `PJ_DRAGGING` guard pauses the `#pj-list` repaint while a drag is in flight (the ~5s poll would otherwise replace the drag-source node and silently abort the reorder); it gates every `#pj-list` writer (paintProjects' main + two empty-state writes, and the loadProjects error path), and paintProjects self-heals a stranded flag (clears it when no `.pj-dragging` row is present) so a future un-guarded writer degrades to a lost drag, never a frozen board. A successful drop clears the flag before repainting; the no-reorder paths (cancel, self-drop, target-not-found) defer to dragend, which clears + catches up any skipped poll update.

## Out of scope / notes
- Client-side order does not sync across devices (localStorage), fine for a local-first single-user app (the plan's stated weakest premise); moves to a server field only if that ever matters.
- Drag is pointer-only (no drop-line indicator in v1); the dragged row dims. A drop indicator is a possible refinement. Josh's in-app eyeball is the final visual pass.
