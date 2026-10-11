# builtpaused-5864: a built task in a paused project reads built, not on hold

Card: joshualeestone/kosmos#5864 (feedback triage, 2026-10-11). Claimed: pigeonpete (night shift).

## Problem
Pausing a project rewrites no task; `tasks.allTasks()` copies `projectPaused` onto each row and `taskState()` /
`listGroup()` checked "own hold OR project paused" BEFORE "built". So a paused project whose work was finished showed
every built task under On hold, and the board read as stalled.

## Decision (written on the card)
No new state: the `built` group ("Built but waiting") already means done-and-awaiting-review. Order becomes:
closed / decision / the task's OWN hold / built / paused project / the rest. The task's own hold still wins (the
person parked that one task). The pause is otherwise unchanged: the Assigner and nudger skip it; an agent's list
still marks it `[on hold: ...]`; both CLIs still print `[on hold]` (and `[built]`) on the row.
Rejected: a new "done, awaiting review" state (a second name for built). Weakest premise: that a person pausing a
project wants finished work shown as waiting for review. Overridable in one line.

## Changes
- engine/tasks.js: taskState and listGroup order; comments.
- server.js: the row-field comment for projectPaused.
- web/index.html: TSK_GROUPS copy for built ("even in a paused project") and held ("not yet built in a paused project").
- engine/onhold-4771.test.js: the old pin (built+paused reads held) replaced by #5864 tests: built+paused reads built
  in taskState AND listGroup with a control (unbuilt paused reads held); own hold beats built, paused or not; an
  agent is still told not to start a built task in a paused project.
- cli.task-list-state-5705.test.js: listGroup pins updated, with a control and the own-hold case.

## Verification
- Targeted: engine/onhold-4771.test.js, cli.task-list-state-5705.test.js, engine/tasks.state-3559.test.js,
  engine/tasks.built-3951.test.js, web.tasks-view-3559.test.js (after no other suite is running on this Mac).
- Mutant: restore the old order in taskState and in listGroup separately; each must turn a #5864 test red.
- Challenge loop, validation (tools/run-tests.sh via the queue), PR, merge.
- Done when (card): on a served build, a paused project with built tasks shows them under Built but waiting. That
  check needs a release, so the card goes needs-release after merge.

## Review log
- Review 1 (opus, blind, read-only): 0 blockers, 2 warnings, 1 convention, 2 nits. W1: both CLIs printed
  [on hold] [built] while the row grouped built, so --state held disagreed with the printed marks; now
  [built] [project paused], with a paused-project fixture for the route and both CLIs. W2/C/N: stale "held is
  checked first" text in CLAUDE.md, the 5705 test, tasks.js and web/index.html. Fixed in 6e262be87.
- Review 2 (sonnet, blind, read-only): 0 blockers, 0 warnings, 1 convention (my CLAUDE.md edit left a duplicated,
  garbled sentence), 3 nits (taskState header lacked held; a web comment). Fixed in cea68de73. Not done, decided:
  a "project paused" hint on a built row of the Tasks view. The CLI prints [project paused]; on the board the
  project's own Paused badge and the task page hint already say it. Optional polish, overridable.
- Review 3 (opus): running, on committed content only (a queued test job may be editing the worktree).
