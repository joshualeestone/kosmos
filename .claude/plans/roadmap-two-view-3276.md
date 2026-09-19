# Plan: Projects board two-view fold-in (Grid + Roadmap) - kosmos#3276

Branch: `roadmap-two-view-3276` off origin/main (v0680).
Spec: `Josh-Brain/Projects/kosmos-roadmap-two-view-foldin-2026-09-18.md` (Mona). Mock: roadmap-mock2.png (Josh approved 2026-09-18 17:51).

## Goal / definition of done

The Projects board settles on TWO views - **Grid** and **Roadmap** - replacing three (Grid / List / org-chart Map). The Roadmap is the existing indented List tree, upgraded to mock2: per-node disclosure triangles that fold in the tab view, connector rails, a right-aligned agent-count + status cluster, and a top summary strip with Collapse/Expand all. The horizontal org-chart Map (which Josh rejected) is removed from the UI. Verified light AND dark, with a browser-check as the #1720 gate.

Done =
- Toggle shows exactly Grid + Roadmap; List removed; Map replaced by Roadmap (new glyph).
- Saved `kosmos.layout.projects` of `list` OR `map` resolves to `roadmap` (no dead key).
- In the tab Roadmap, a parent row's caret folds/unfolds its branch (`aria-expanded` flips, descendants hide), collapsed state remembered per project id (best-effort).
- Roadmap rows are denser (no description, no faces) with the count pill + status right-aligned; connector rails show depth.
- Top strip: "N projects · N need you" + Collapse all / Expand all + the existing sort.
- Grid view unchanged. Consolidated rail unchanged.
- CI green: full node suite + the projects browser-check, both themes.

## Key facts verified against origin/main (not assumed from the spec)

- `LAYOUTS.projects` @22445: `{el:'pj-list', cls:'asgrid', flip:'grid', fallback:'grid', layouts:['grid','list','map'], mapEl:'pj-map'}`. Grid = `.asgrid` ON; List/Roadmap = `#pj-list:not(.asgrid)` (the tree); Map = separate `#pj-map`.
- Grid AND List render the SAME markup: `pjTreeRows(active)` → `projectCard()` into `#pj-list`, differentiated by CSS. So the Roadmap IS the list renderer + CSS/JS upgrades. (Spec confirmed, code confirmed.)
- Tab-list indent + a proto-rail already exist: `body:not(.consolidated) #pj-list:not(.asgrid) .pj-row {margin-left: --pj-depth*22px}` @2999 and `.pj-row.child {border-left:2px solid --k-rule}` @3003.
- Fold machinery EXISTS but is gated on `body.consolidated`: `applyConsFold()` @37490 (hides `.pj-fold-hidden`, flips `aria-expanded`, caret glyph), `PJ_TREE_FOLDED` @37211, `pjTreeToggleFold` @37545, caret `.pjtreefold` rendered on any parent @37820 but CSS-hidden outside consolidated (`#pj-list .pjtreefold {display:none}` @3002; shown only under consolidated @3898). Click delegate `data-pjtreefold` @44137.
- **`orgTreeOf` @21946 is NOT map-only** - used @22077 by the agents org view. KEEP it. (Spec's "retire orgTreeOf" is wrong for this codebase.)
- Map-only machinery (safe to retire from UI now, delete later): `#pj-map` @11327, `paintProjectsMap` @37285, `pjMapNode` @37266, `PJ_MAP_FOLDED` @37204, `pjHasSubprojects` @37196, the map-refresh block in `paintProjects` @37079-37096, `placeProjectsView` map lines @30865-30867, the `#pj-map` click delegate @44167, `body.pj-mapmode` CSS @2930-2932 + the Map org CSS block. **`#pj-map` has a boot delegate (@44167) that throws if the element is removed without the delegate - do not remove one without the other.**
- Browser-check `render-projects-map.js` drives the Map button + `paintProjectsMap` + `pjHasSubprojects`; wired in `tools/browser-checks.sh` @1282 and named in README @302. Retiring the Map UI => this check must go. `render-projects.js` is the wired projects check to EXTEND for Roadmap coverage.
- Wiring test `browser-checks-indexed.test.js`: asserts README names every script and vice-versa (a set-equality, not a hard count). Removing a check ⇒ remove its file + its README row together.

## Steps

1. **Toggle UI** (@11310-11320): keep Grid; remove the List button; change the Map button to Roadmap (`data-layout="roadmap"`, indented-outline glyph, aria-label/title "Show projects as a roadmap").
2. **LAYOUTS + migration** (@22445): `layouts:['grid','roadmap']`, drop `mapEl`. Add `pjLayoutMigrate(v)` mapping `list`|`map`→`roadmap`. Apply it in the boot restore loop (@22497, projects scope only - agents keeps its own `list`) and in `placeProjectsView` (@30874). Persist the migrated value on boot so the stored key is cleaned.
3. **layoutApply** (@22456): remove the `if (lay.mapEl)` map branch (no more `pj-mapmode`).
4. **Enable fold in the tab Roadmap** - `applyConsFold` (@37490): compute `treeMode = list && !list.classList.contains('asgrid')` (true for the consolidated rail AND the tab roadmap, false for grid). Use `treeMode` (not `cons`) for the fold parts: `shouldHide`, the `cutoff`, aria-expanded add/remove, and keep the caret glyph flip unconditional. **Keep `row.draggable = cons && depth===0`** (drag stays consolidated-only). CSS: show the caret and hide folded rows in the tab roadmap:
   - `body:not(.consolidated) #pj-list:not(.asgrid) .pjtreefold { display:inline-flex; ... }` (mirror the consolidated caret positioning, absolute in a reserved gutter keyed on `--pj-depth`).
   - `body:not(.consolidated) #pj-list:not(.asgrid) .pj-row.pj-fold-hidden { display:none; }`
   - Reserve the caret gutter with `padding-left` on the tab-list row keyed on `--pj-depth` (adapt the @3891 consolidated rule).
5. **Density + right-aligned meta** - tab-roadmap CSS only (`body:not(.consolidated) #pj-list:not(.asgrid)`): hide `.pc-t` (description) and `.pjfaces` (faces); keep the count via a right-aligned cluster. Restyle the row grid to `name | (spacer) | count+status right`. Keep the count pill visible (it currently lives inside `.pjfaces`; either move the count out or reveal only the count within `.pjfaces`). Decision: reveal only `.pjcount` inside `.pjfaces` (hide the faces `[aria-hidden]` span), right-align `.pjfaces` + `.pjpill` together.
6. **Connector rails**: upgrade the `.child` left border into a clearer file-tree rail (a vertical guide + a short horizontal elbow via `::before`/`::after` keyed on `--pj-depth`), tab roadmap only. Pragmatic scope: one rail at the row's own depth + elbow (full multi-ancestor rails need per-level sibling knowledge CSS lacks; documented).
7. **Top strip**: add a roadmap-only strip above `#pj-list` - left `N projects · N need you` (reuse the `st-pj`/`st-pjattn` values), right Collapse all / Expand all + the existing `#pj-sort`. New JS: `pjFoldAll(fold)` sets/clears `PJ_TREE_FOLDED` for every parent id then `applyConsFold()`. Show the strip only in roadmap (CSS keyed on the tab-list context, or a body class set in layoutApply).
8. **Map unreachable**: after steps 1-3 the Map cannot be selected. Leave map CODE inert with a `#3276 follow-up: delete` comment at each site; keep `#pj-map` + its delegate together so nothing throws. File the deletion follow-up card.
9. **Tests**: remove `render-projects-map.js` + its README row + its runner entry (Map UI retired); update `browser-checks-indexed.test.js` if it enumerates. Extend `render-projects.js` to drive the Roadmap: toggle to roadmap, assert caret folds a branch (child `display:none`, `aria-expanded=false`) and re-expands, description/faces hidden + count visible, both themes, plus a no-leak control (grid still shows description/faces). Run the FULL node suite (memory: editing any test file - re-run all) + the projects browser-check.
10. **Challenge-loop** (mandatory), converge, hash-verified proof, then PR to `joshualeestone` reviewer, screenshot attached.

## Decisions + weakest premises (decide, document)

- **Split the map-code DELETION to a follow-up.** Reversible; keeps this PR focused on the visible feature + its test churn. Weakest premise: leaving inert code one release is untidy and a challenger will flag it - mitigated by an explicit comment + a filed card. If Josh/challenge prefers one PR, fold the deletion in (it's mechanical).
- **Keep `orgTreeOf`.** Measured shared with the agents org view; deleting it would break that view. Not a judgement call - a fact.
- **Connector rails = single-depth elbow, not full ancestor rails.** CSS cannot know which ancestors have following siblings without per-level markup. The elbow + indent reads as the mock's rails; full rails would need markup changes to every row. Start with the elbow; revisit if Josh wants the full ladder.
- **Density drops (description, faces) per the spec.** Both live one click away (Grid + single-project view). Weakest premise: bare names hurt a brand-new user - mitigation in the spec (top-level second line) deferred until Josh asks.
- **Fold state persistence**: reuse `PJ_TREE_FOLDED` (in-memory, per session). The spec says "remembered per project id (localStorage, best-effort)." `PJ_TREE_FOLDED` is currently in-memory only. Add a best-effort localStorage mirror (`kosmos.fold.projects`) so a collapse survives reload, matching the spec. Weakest premise: an extra storage key; guard every read/write in try/catch like the sort/order keys.

## Traps (from memory + this file)
- Editing any test file ⇒ run the FULL node suite, not just the touched file (bit me twice on #3264).
- pre-challenge diff_hash: commit the plan file FIRST, then compute the hash (plan is IN the diff; only the proof is excluded).
- web/index.html change ⇒ needs a browser-check or surface trailer (#1720). Adding/removing a check ⇒ update runner + README + wiring test together (#1387), and mind the #1469 brace-anchor if touching the runner loop.
- Coordinate the hot file with Mona's #2690 (she is in DESIGN, not the file, as of 20:09 CT - confirmed free); merge-tree check before the PR.
