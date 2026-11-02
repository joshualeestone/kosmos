# kosmos#7788: what is waiting on you, in one place

Branch: waitingonyou-7788. Steps 1 to 3 are committed (engine `onHoldForPerson`, `kosmos task hold --for-you` on
Mac and Windows, the agent instruction line). This plan covers step 4, the screen.

## Finished looks like

A task an agent held with `--for-you` is counted by the red Needs Your Decision tile and listed in its group,
oldest wait first, and its row says what it waits on (the hold's reason) and how to clear it (lift the hold).
A hold the person set, or an agent's hold without `--for-you`, stays in On hold exactly as today.

## Call (Mona Lisa, 2026-11-02)

Slice A, this branch: the engine's `taskState` reads `decision` for an open task held for the person, ahead of
`held`. Every surface that already reads the state (the tile count, the group, the row) then agrees with no second
rule in the page. The hold itself is unchanged: `isOnHold` still says held, so the Assigner and nudger still skip it.
The row gets one line: the reason, and "Take it off hold once you have answered." with the existing hold control.

Slice B, a follow-up card: an agent asking the person a question that is tied to NO task of the project. Today it
shows on the Agents page and the project's Issue list, not on Tasks. Folding it into the tile needs rows that are not
tasks, a different row shape and click target; it is a separate build.

Rejected: a page-side rule adding held-for-you tasks to the decision count. It would make the tile and the
`state` field disagree, and every other reader of `state` (the CLI list, the project card) would still say held.

Weakest premise: that nothing reads `state === 'held'` to mean "Kosmos must not touch this". Measured: the
Assigner and nudger read `isOnHold`, not `taskState` (grep of engine/ for taskState consumers, 11-02). If that is
wrong, a held-for-you task could be handed out.

## Steps

1. engine/tasks.js taskState: `decision` for an open task with `isOnHold && onHoldForPerson`. Test both arms in
   engine/holdforperson-7788.test.js, plus the control (a plain hold stays `held`).
2. web/index.html decision row: the hold reason and how to clear it, for a held-for-you row.
3. Group copy (`why`) names holds that wait on you.
4. /design-shots, browser check, challenge loop (cap 8), validation, PR.
