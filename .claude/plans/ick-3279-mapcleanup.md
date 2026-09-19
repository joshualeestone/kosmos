# #3279: delete the retired org-chart Map dead code + the superseded #3135 block

**Branch:** `ick-3279-mapcleanup` · **Card:** kosmos#3279 (follow-up to #3276/#3278).

## Why

#3276 (impl PR #3278) shipped the two-view Projects board (Grid + Roadmap) and retired the
org-chart "Map" view from the UI (button removed, dropped from the layout allowlist, saved
list/map prefs migrated to roadmap via `pjLayoutMigrate`) but deliberately LEFT the now-unreachable
map code in place to keep that PR focused. #3279 is the mechanical cleanup: delete the dead code.
No behavior change (the Map has had zero live entry points since #3278).

## What is deleted (all verified zero live callers before removal)

`web/index.html`:
- JS: `pjHasSubprojects`, `PJ_MAP_FOLDED`, `pjMapNode`, `paintProjectsMap`, and `pjMapFit`.
  `pjMapFit` was NOT in the card's list but is map-only: its only callers were `paintProjectsMap`
  and one line in the resize listener, both removed (that listener otherwise stays live).
- The `#pj-map` element + its boot click delegate (they had to go together: the delegate referenced
  `paintProjectsMap`/`PJ_MAP_FOLDED`).
- The `placeProjectsView` reset lines that cleared `pj-mapmode` / hid `#pj-map` (surgical: the
  pj-roadmap and `#pj-list.asgrid` resets in the same branch are KEPT).
- The map org-chart CSS block (`.pjorgwrap`/`.pjnodewrap`/`.pjorg`/`.pjonode`/`.pjfold`/`.pjoc`/
  `.pjonm` + the `@media` dark variants) and the `body.pj-mapmode` rule.
- The `#3135` multi-column List CSS block (marked `#3276 follow-up: delete`, unreachable since the
  roadmap rules always win and the old List view is gone).

`docs/browser-checks/`: delete `render-subproject-columns-3135.js` (tested the retired multi-column
List) + its runner entry in `tools/browser-checks.sh` + its README row. No hardcoded browser-check
count invariant exists, so nothing to bump.

`web.consolidated-projects-view-3052.test.js`: the map is gone, so the fixture no longer seeds
`pj-mapmode`/`#pj-map` and the two assertions on them are dropped; the #3052 fix (force the list in
the consolidated view) is now asserted via the surviving grid-class clear. The #3276 map->roadmap
localStorage-migration tests are KEPT (`saved: 'map'` is a legitimate legacy VALUE handled by
`pjLayoutMigrate`, unrelated to the deleted `pj-mapmode` class).

## Kept (verified live, NOT touched)

`PJ_TREE_FOLDED`, `pjSaveFold`, `PJ_ORDER`, `pjSaveOrder`, `pjClearOrder`, `pjManualOrderActive`,
`PJ_DRAGGING` (they sit INSIDE the map-code region, 37368-37440, but are heavily used by the live
consolidated rail + Roadmap fold/drag). `orgTreeOf` (the agents org view, which uses bare `.onode`,
not the `.pj`-prefixed map classes). The live `.pj-roadmap` CSS and the bare `.pc-t`/`.pj-row` base
rules.

## Companion steps (not in the card's literal list, required for correctness)

- The forced-dark mirror of the deleted `@media` map rules is REGENERATED, not hand-edited:
  `node tools/sync-forced-theme.js` (verified `--check` clean; `web.theme.test.js` asserts parity).
- Stale comments that named the deleted Map/`data-pjfold`/`.pjonode.attn`/the deleted browser-check
  are updated to reflect the two-view reality.

## Verification

- `node --test web.consolidated-projects-view-3052.test.js`: 6/6.
- Full validation suite (`validation_log_run_or_skip`): passed.
- Projects browser-checks (render-projects, render-consolidated-layouts, render-projects-roadmap-3276,
  render-subprojects-1994, render-cluster-reorder-2929, render-cons-tree-2929, render-pjsettings): run
  to confirm the surviving Grid/Roadmap/rail views render after the CSS/JS removal.
- em-dash clean.
