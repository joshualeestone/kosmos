# tasks-pill-4595: take the Tasks pill out of the projects list header (kosmos#4595)

## Why
Josh, #admin 2026-09-29 12:02 CDT: "let take out the little "tasks" bubble in teh projects lest.. looks sloppy
and now people can access it form the top". The pill is `#rail-projects-tasks` beside the "Projects" name.

## Checked before removing
- The consolidated layout shows the tab bar (#4345 put it back): `consNavLight` lights `#tabs .tab`, and a
  click on the Tasks tab there calls `openConsolidatedTasks()`, so the pill was not the only way in.
- The tab is behind the same 25-task gate the pill was (`tskTabGate`), so nothing appears or vanishes
  differently for anyone.

## Change
- web/index.html: the button, its CSS, its click listener and its entry in `tskTabGate`; the comments that
  described it as the consolidated view's way in are corrected. The + (new project) stays.
- Tests: web.tasks-view-3559 and web.tasks-look-3559 assert the pill is ABSENT and the tab still opens
  Tasks in the column; render-tasks-view-3559.js enters the consolidated Tasks view through the tab and
  asserts no pill. Putting the pill back reds both.
