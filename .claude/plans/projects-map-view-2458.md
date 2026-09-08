# Projects Map view (Item C, #2458 follow-up; Josh: "map view right now")

Branch: `projects-map-view-2458`. Repo: agent-workforce (kosmos). Owner: Angel.
Spec: `chaoskosmos-site` origin/main `design/subprojects.html` (section 3, "The Map"). Design owner: Mona.
Scope (Josh 2026-09-08 02:09): the Map view + the Grid/Map toggle ONLY. The grid-grouping-by-family
and path-on-card (the other half of section 3) are pinned for later.

## Definition of done
- The Projects tab viewtoggle gains a third option, Map, beside Grid and List.
- Choosing Map draws the project hierarchy top-down as an org chart: a Kosmos root at the top,
  every top-level project hanging off it, sub-projects nested under their parents, recursively.
- Each node shows the project name and a count line (N agents / idle / needs you), attention-styled
  when the project needs you.
- It scrolls sideways for a wide fleet; it never wraps or truncates the shape.
- The choice persists (localStorage, same mechanism as grid/list).
- WCAG AA: the toggle is a real button group; nodes are readable text.

## Build (web/index.html)
1. CSS: port the spec's `.orgwrap/.org/.onode` org-chart, PREFIXED to `.pjorgwrap/.pjorg/.pjonode`
   (bare `.onode` is already the AGENTS org-view node, styled globally at ~1307 -- must not collide).
   `.pjonode.top` (Kosmos root) and `.pjonode.attn` (needs-you) modifiers.
2. Markup: a `#pj-map` container (`.pjorgwrap`, starts hidden) beside `#pj-list` in the Projects tab.
   A third viewtoggle button `data-layout="map"` (tree icon) at ~9382.
3. LAYOUTS.projects: `layouts: ['grid','list','map']`, `mapEl: 'pj-map'`. Extend `layoutApply` with a
   projects branch: map mode hides `#pj-list` + `#pj-arch-wrap` and shows `#pj-map` (+ paints it),
   grid/list mode shows the list (asgrid toggle) and hides the map. `[hidden]{display:none!important}`
   makes the flip stick against the consolidated-layout display rules.
4. `paintProjectsMap()`: reuse `pjTreeRows`' `kids` (parent->children) grouping + cycle/orphan guards
   to build nested `<ul><li>`; each `.pjonode` from name + `p.summary.total` (count) + `pjPillOf` (attn).
   Kosmos root count = total agents on the board (from the agents roster `LAST`). Call it from
   `paintProjects()` whenever map mode is active, so a data poll refreshes it.

## Guard
- Extend `docs/browser-checks/render-subprojects-1994.js` (or a new `render-projects-map.js` + the 3
  count bumps) to drive the Map toggle and assert the org tree renders the parent/child shape and the
  attn node. Modified existing check = no count bumps; a new check needs runner list +
  browser-checks-reason-grep EXPECTED_SITES/CATCH_SITES + README row.

## Open design question (ask Mona in #chaoskosmos-design if it blocks, do NOT stall)
- The Kosmos root node's count: total board agents vs nothing. Defaulting to total board agents
  (honest, matches the mock's "N agents"); trivially changed if Mona wants otherwise.

## Verify
- node validation + the full `run-tests.sh` gate; the projects-map browser-check locally
  (NODE_PATH=$HOME/work/pw-runtime/node_modules).
- /challenge-loop to convergence; screenshot to the channel; merge on green (beta rule).
