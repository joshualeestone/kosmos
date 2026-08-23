# newtask-page: #383, creating a task is a page, like viewing one became

## The defect

Josh, 12:45: hitting + for a new task still pops a modal. #206 converted
VIEWING a task to its own page and was closed correctly; creation was a
second surface wearing the same symptom, never in anyone's scope.

## The shape

The modal's fields move verbatim (pack FROZEN-2026-08-16: two things
asked, one required, default-to-nobody hint) into #pj-newtask-view, a
sixth pjView surface beside the task page. Back is the leave; there is no
Cancel, no backdrop, no focus trap and no Escape, because a page is not an
overlay, which is #206's own ruling extended to the surface it missed.

The modal's never-delete rule survives with a sharper edge: NT_FOR keys
the typed draft to its project, so Back keeps the words, reopening for the
same project keeps them, and a different project starts clean, so a
half-written task cannot be filed under the wrong project. Success clears
the draft and lands back on the project where the new card appears.

The Escape handler and the focus-trap entry are REMOVED, not bypassed;
the trap list stays, empty, so the next dialog inherits working machinery.

## What the check migration surfaced, fixed in the same branch

docs/browser-checks/render-tasks.js named a REAL session as the task's
member, and every run of the check typed the membership tell into that
agent's live pane (measured: it landed in mine mid-branch). Sandboxing the
store is not sandboxing delivery. The spawned server now gets the fake
tmux with a fixture member, so the roster is the fixture and a send goes
nowhere. The check was also still waiting on the pre-#206 #tk-modal, so
it has been red on main since that merge; migrated to the page flow.

## Tests

web.task-page.test.js: the trap/Escape pins INVERTED for the new surface
(the old control asserted the modal kept them), the page markup and leave
present, the pjView list pinned with 'newtask', and the draft's two
branches pinned (kept for the same project, cleared across projects and
on success). The browser check drives the page end to end: + navigates,
Escape leaves it standing, the draft survives Back, both creates land,
plus everything it already proved about the column, the door and the join.

## Review bound

Two rounds maximum, declared before starting.
