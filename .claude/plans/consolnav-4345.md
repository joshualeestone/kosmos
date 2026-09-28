# consolnav-4345: Agents / Projects / Tasks stay in the top nav in the consolidated view (kosmos#4345)

Josh, #admin 2026-09-28 09:21 (verbatim on the card). Moved to PigeonPete from Mona Lisa 10:32.

## What exists (measured on origin/main 06df7aa9b)
- The consolidated view hides the whole top nav:
  `html[data-layout="consolidated"] body.consolidated > .apphead .tabs { display: none; }` (~line 4431).
- `showTab(tab)` sets `body.consolidated` only for `agents` and `projects`; Tasks and Settings leave it.
- The consolidated display column is `#panel-projects`. `takeOverDisplayColumn()` hides the project
  views and any relocated overlay, and keeps `#pj-list-view` (the projects column) beside it.
  Settings, New Agent and Tasks already open there (`openConsolidatedSettings/Create/Tasks`),
  each relocating its panel in with a `place*Panel(cons)` helper from the `showTab` chokepoint.
- Agents: the rail is `#alist` (forced to the list layout in consolidated). The org chart
  `#orgview` and the card grid `#grid` are separate elements; `boardApplyVisibility` hides both in
  consolidated.
- Projects: the projects column and the Projects tab both render into the ONE `#pj-list`
  (`paintProjects`, ~250 lines), so the full grid cannot also sit in the display column without a
  second render. Rows open with `openProject(id)`, the same call the rail uses.
- 35 consolidated rules style `.pj-row` via `body.consolidated .pj-row` WITHOUT the `#pj-list` id, so a
  copy of the rows elsewhere in the consolidated page would take the rail's look.

## Decision: two slices
**Slice 1 (this branch):**
1. In the consolidated view the top nav shows again (Agents, Projects, and Tasks when the person has it).
2. Clicks there do not call `showTab` (which would drop to the tab view). They load into the display
   column:
   - **Agents:** the person's agents view, relocated into the display column: the org chart if their
     saved Agents layout is org, otherwise the card grid (the list is already the rail beside it).
     Clicking an agent there opens that agent's page, the same call as the rail (the cards' own
     handlers, unchanged).
   - **Tasks:** `openConsolidatedTasks()` (exists).
   - **Projects:** returns the display column to the plain consolidated board (active project, or
     the list). This is also Josh's "easy way to get back" (point 5).
3. The lit tab says what the display column holds (Agents / Tasks / Projects for the board).

**Slice 2 is #4377, and it is part of Josh's ask, not an extra** ("you could see your full projects and
you could sort it in different ways"). #4345 stays OPEN until it lands; slice 1's PR says "Addresses
#4345", never a closing keyword. Slice 2: Projects loads the full projects grid, with its sort, into the display
column (Josh's point 4 behaviour: a click activates that project, never a nested view). That needs a
second render of the rows in a container whose styling is not the rail's: either scope the 35
`body.consolidated .pj-row` rules to `#pj-list`, or give `paintProjects` a second target. Built as a
second slice (next, not later) because it touches the projects column every agent's day depends on,
so it gets its own review loop.

**Rejected:** calling `showTab` from the consolidated nav (it drops to the tab view, which is the thing
Josh is complaining about); an iframe or a second app instance (two pollers, two truths).

## Weakest premise
That "Projects returns to the board" reads as right to Josh until slice 2 (#4377) lands. He asked for the full
projects view in the panel; slice 1 gives him the way back first. He can override the order.

## Tests
- Unit/DOM: clicking each top-nav item in the consolidated view keeps `body.consolidated`, shows the
  right thing in the display column, and lights the right tab; an agent click in the panel opens the
  agent page; tab view unchanged (control).
- Browser check (`docs/browser-checks/render-*.js`) for the nav being visible and the org chart in
  the column.

## Collisions checked 10:40
replybar-4358 (lines 6288-6306, 52430-53371), restartscreen-4343 (1354, 17349, 20248-21144, 38435-38562),
updchannel-2969 (19707). This branch touches ~4431 (CSS), 21329 (showTab), 38953-39110 (place/open
helpers), 28361 (tab click). Re-check with `git merge-tree` before the PR.

## Review round 1 (opus, blind): 0 BLOCKER, 3 WARNING, 5 NIT
- WARNING (reproduced) from an agent's page or the full Tasks page (both drop the consolidated class),
  Agents landed on the board and "All agents" ignored where the person came from. The nav now keys on
  `layoutConsolidated()` (the saved layout, with the 960px floor), and "All agents" returns to the Agents
  view when the agent was opened from it (`CONS_AGENTS_RETURN`, set in showTab).
- WARNING (reproduced) Projects fell through to the tab's top-of-section reset and dropped the open
  project. Decided: in the consolidated view Projects keeps the active project; the projects column is
  always on screen, so there is no top to reset to.
- WARNING a person on the grid could never reach the org chart Josh named from the column. Added a
  Grid / Org chart switch in the column, saved to the same `kosmos.layout.agents` key as the board's
  own toggle (List is not offered: the list is the rail).
- NIT a takeover left the grid/chart unhidden inside the hidden wrapper, so the poll repainted an
  invisible chart. takeOverDisplayColumn now re-hides them. FIXED.
- NIT the URL does not record the Agents view. KEPT, like consolidated Settings (a reload restores the
  board, the durable state); commented.
- NIT aria-selected on a tab that controls no panel: pre-existing, KEPT.
- NIT burger lines in the new branch could never run: REMOVED.
- NIT the tabs pin missed `display:none` without a space: tightened, proven on that spelling.
- Browser check 30 -> 44; every round-1 fix mutated back turns it red (5 of 5; one mutant first
  failed to apply and read as a pass, caught by asserting the edit landed).
