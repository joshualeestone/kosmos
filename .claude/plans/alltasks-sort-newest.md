# Plan: View-All (all-tasks) screen sorts tasks newest-first (#3183)

## Goal / done-condition
The View-All all-tasks screen (the door reached from a project) shows its OPEN task group
newest-first (highest task number on top), matching the per-project task column that #3172
already flipped. Done when `engine/tasks.js` `allTasks()` returns each half (open, closed)
in descending task-number order within a project, with a test that fails if the direction
reverts, and the existing #1382 tests (open-before-closed, project-name order) still pass.

## Why
Josh, 2026-09-16 (#3172, msg 1549757212367392880): the per-project column "sorts by the
first task that was ever created, which is also the oldest task and has the highest
likelihood of being done." #3172 flipped the column to newest-first. The same rationale
applies to the View-All screen, which still sorted its open group oldest-first. I flagged
this to Josh at 09:27 CDT ("say the word") and am proceeding on his standing ruling
(make the reversible call; he can undo) rather than leaving it dangling.

## Change (minimal)
- `engine/tasks.js` `allTasks()` (~:646): the sort is open-before-closed, then project
  name, then task number. Flip the number tiebreak from ASC `(a.number)-(b.number)` to
  DESC `(b.number)-(a.number)`. This is ONE shared comparator, so BOTH halves become
  newest-first; open-before-closed grouping is preserved. Update the comment to state the
  new direction and cite #3183/#3172.
- The View-All render (`web/index.html` `openAllTasksView`) TRUSTS the server order
  ("one sort, the server's"), so NO render change is needed and the web-change browser
  gate does not apply.
- `engine/tasks.all-1382.test.js`: add two tests pinning newest-first within a project
  (open half and closed half). The existing tests pin only open-before-closed and
  project-name order, not the number direction, so this direction was previously untested.

## Decisions / trade-offs
- Flip the SHARED tiebreak (both halves newest-first) rather than an isClosed-conditional
  sort. Simpler, one comparator, matches the "one sort" convention; newest-closed-first is
  a sensible default (most recently finished on top). Reversible if Josh wants asymmetry.
- Backend-only change; the render is untouched by design.

## Lane / coordination
- Edit is in `engine/tasks.js` (Angel's technical lane). Heads-up sent to Angel before
  taking the file per Josh's 2026-08-23 coordinate-first ruling; Angel confirmed clear
  (her #3182 touches only engine/machine.js + engine/create.js). No open PR touches
  engine/tasks.js.

## Weakest premise
Josh scoped #3172 explicitly to "the project column" and I raised View-All as a separate
question. Building it answers my own question without his reply. Mitigated: it is a
one-token reversible tiebreak, consistent with his stated rationale, and he can flip it
back. What would change my mind: Josh saying he wants the index chronological.
