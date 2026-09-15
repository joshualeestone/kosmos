# #3052: the consolidated view needs its own projects view (not the tab's last mode)

**Branch:** `consolidated-projects-3052` · **Card:** kosmos#3052 · For 6.65 · Filed by Splinter
from Josh's 6.63 testing.

## The bug

Josh, verbatim: "When I'm in the consolidated view, it's picking up what my last view of projects
was. If I left my projects tab view on the org chart, higher org chart and roadmap view, or
whatever we call it, that's what I see on my consolidated view under projects, which is messed up
because I can't see anything. The projects view on consolidated needs to be its own view that will
be specific to projects."

## Root cause

The Projects TAB has three layout modes: grid / list / map (the map is the project org-chart,
`#2458`). The chosen mode is persisted as `kosmos.layout.projects` and applied by `layoutApply`,
which sets `body.pj-mapmode` (+ hides the list, shows `#pj-map`) for the map, and `#pj-list.asgrid`
for grid. `paintProjects` (web/index.html ~36836) delegates to `paintProjectsMap` when
`body.pj-mapmode` is set.

The consolidated view's projects panel (`#pj-list-view`) reads that SAME body state. So a tab left
on the Map made the narrow consolidated column draw the project org-chart, where nothing is legible.

## The fix

`placeProjectsView(cons, wasCons)`, called from `showTab` (the one chokepoint that knows the
EFFECTIVE view: saved layout AND the 960px width gate, resize included), alongside the existing
reversible `placeSubProjects` / `placeAppSettings` / `placeCreatePanel` helpers.

- **Entering consolidated (`cons`)**: force the panel's own view, the readable list, for DISPLAY
  only: drop `body.pj-mapmode`, hide `#pj-map`, drop `#pj-list.asgrid`. It NEVER writes
  localStorage, so the tab view's chosen mode survives.
- **Leaving consolidated (`wasCons && !cons`)**: re-apply the saved projects layout via
  `layoutApply('projects', saved)` (allowlist-or-fallback, same as the boot restore), so the tab
  view restores the person's grid/list/map choice.

This is the projects analogue of the Agents pack, which `boardApplyVisibility` already forces to
`list` in the consolidated view (`consolidated ? 'list' : BOARD_LAYOUT`) without touching the pack's
saved `BOARD_LAYOUT`. The restore-on-exit mirrors showTab's existing
`if (wasCons && !cons) boardApplyVisibility(agents)`.

It runs BEFORE the consolidated `loadProjects()` in showTab, so `paintProjects` sees the cleared
map state and renders the list. The projects viewtoggle is `display:none` in consolidated, so
nothing can re-enter map mode there and no button state needs updating; the restore path's
`layoutApply` repaints the toggle for the tab view.

## Scope

Forces the LIST for both former map and grid modes in consolidated (grid, like map, is not the
panel's own view). Josh's report names only the org-chart/roadmap modes as broken, but "its own
view specific to projects" reads as one fixed view; forcing the list covers every non-list mode,
including any future one, the same way the Agents pack forces list regardless of its saved mode.

## Tests

`web.consolidated-projects-view-3052.test.js` extracts and runs the shipped `placeProjectsView`
against a stub DOM + localStorage: consolidated drops the map/grid state (controls prove it), the
consolidated force never writes storage (so the tab choice survives), leaving consolidated restores
the saved mode, and a foreign/blocked value falls back to the default rather than guessing. A
source-pattern assertion pins the showTab wiring (call present, before `loadProjects`).

## Browser-check note (weakest premise)

This is a visual bug, and a seeded-sandbox browser check asserting "map saved -> consolidated shows
the list, not the org-chart" would be the gold-standard coverage. The fix is DOM-state logic
(fully node-tested, including the `#pj-map` hidden / `pj-mapmode` off / `asgrid` off states the CSS
turns into the visual).

To be precise about what is and is not browser-covered today: render-consolidated-layouts.js sets
only `kosmos.layout.AGENTS` and asserts the consolidated panel's PRESENCE and rail geometry
(`#alist`, `#pj-list-view`, `#rail-agents`, `#rail-projects`). It does NOT set
`kosmos.layout.projects='map'` and does NOT assert `body.pj-mapmode` / `#pj-list.asgrid`, so it does
NOT exercise this PR's exact regression (a tab left on Map drawing the org-chart in the narrow
consolidated column). That scenario is therefore covered only at the DOM-state level (the node
test), not visually, today.

So a live seeded-sandbox assertion is a genuine gap, not a redundancy: adding a case to
render-consolidated-layouts.js (or a new check) that seeds `kosmos.layout.projects='map'`, enters
consolidated, and asserts `#pj-list` is shown and `#pj-map` is hidden is the right follow-up. It is
deferred here (night shift, no seed board handy). The weakest premise is that the DOM-state node
test stands in for that live assertion until the follow-up lands.
