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

## 🔄 DESIGN PIVOT (Mona, 2026-09-08 ~00:30 CT) -- the v1 above is HELD, not merged

Mona (design owner) redirected: the projects Map must MIRROR the existing agent org-view
(#137, April's `paintOrg`), reusing its pan / deep-tree / (manual) fold / horizontal-scroll
mechanics, NOT the static 3-level CSS org-chart the v1 built from. The v1 is a held foundation.

**Confirmed deltas (Mona, verbatim intent):**
- A node is a PROJECT: its name + its OWN agent count + a needs-you mark when an agent inside
  it is waiting. (The tree organises, it does not cascade -- each project's own count.)
- Clicking a node OPENS that project (mirror `paintOrg`'s click-to-open-agent, opening the
  project instead).
- Kosmos root keeps the gold family accent.
- Behind the Grid/Map toggle on the Projects tab.
- **Expand/fold default: FULLY EXPANDED.** Nothing starts folded; no auto-collapse of deep
  levels; let pan + scroll carry a big tree. Folding is a MANUAL per-branch affordance only.
  **Match whatever `paintOrg` does for its own default** so the two org views stay consistent.

**Carryover from v1 (Mona: keep all of it):** the Grid/Map toggle + LAYOUTS/localStorage
integration; the project-tree build from the parent/child data with cycle+orphan guards; the
per-node count / needs-you derivation; the browser-check scaffold. **Swap:** the static CSS
chart -> the org-view render + clickability.

**`paintOrg` mechanics survey (web/index.html, origin/main):**
- `orgTreeOf(agents)` (~18540) builds the tree; `orgPlace(nodes)` (~18588) positions it as a
  RADIAL / force-directed layout (a central hub + nodes by angle+radius: `Math.cos(ang)*r`,
  `Math.sin(ang)*r`), NOT top-down. `orgStep` (~18480) is the force step (vx/vy/alpha).
- `paintOrg` (~18642): centres on the DRAWING (not the hub), pads, honours a `?limit` slice,
  and shows an empty/looking state gated on BOARD_SEEN. It draws EVERY node (no fold) -> its
  default is already fully expanded, which matches Mona's ruling.
- Pan: `orgmap` `pointerdown` drag handler (~18900). Click-to-open: `orgmap` `click` (~18944).
- 🔴 OPEN RECONCILIATION (Mona's spec settles it, do NOT guess): `paintOrg` is RADIAL while the
  subprojects.html mock is TOP-DOWN. Whether the projects Map is radial-like-paintOrg or
  top-down-with-paintOrg's-pan/click is the one thing to read from her merged spec. Manual
  per-branch fold appears to be NEW (paintOrg has no fold), so that is a delta to add.

**Status:** waiting on Mona's strengthened `subprojects.html` (in challenge-loop review; she
pings on merge). Build straight to it then, reusing the survey above.

### Iteration-2 findings to FOLD INTO THE REBUILD (v1 confirmed solid otherwise)
Iter-2 (blind) confirmed the boot-TDZ fix, the cycle/orphan invariants, the dark-mode CSS
(both spellings), and the reason-grep/count discipline are all correct. Carry these into the
org-view-mirror render:
- **WARNING (real, carries over): empty-state parity.** The map must distinguish the list's TWO
  empty states, or the two layouts contradict: `!PROJECTS.length` -> "No projects yet. Point
  Kosmos at a folder you already have…" (+ Add a project); `!active.length` with `PROJECTS.length`
  (all archived) -> "Nothing here right now. Everything you have is archived." The v1 collapses
  both into the first (misleading when all-archived). Fix in the rebuild; drop the false
  "same-empty-state-words" comment. (Or, in the org-view render, show the Kosmos root with no
  children for all-archived.)
- **NIT: browser-check worded error prefixes** (`console.error('render-projects-map: '+r.error)`
  and the page-error line) have no `FAIL ` marker, so reason-grep cannot quote them if they fire.
  Add the `FAIL ` prefix in the rebuild's check.
- **NIT: cycle coverage completeness** -- assert a deep cycle (a->b->c->a) and self-parent (a->a),
  not just the 2-node cycle. (Logic traced correct for all three; this is coverage only.)
- Also unresolved on the v1: the theme-parity gate wants `node tools/sync-forced-theme.js` run to
  regenerate the FORCED `:root[data-theme="dark"]` twins from the `@media` source (the manual
  forced rules are in a generated region -- "edits inside a generated region are on loan"). Handle
  the dark-mode CSS + the generator run when the rebuild's CSS is final, not before.
