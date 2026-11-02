# kosmos#7788: what is waiting on you, in one place

Branch: waitingonyou-7788. Steps 1 to 3 are committed (engine `onHoldForPerson`, `kosmos task hold --for-you` on
Mac and Windows, the agent instruction line). This plan covers step 4, the screen.

## Finished looks like

A task an agent held with `--for-you` is counted by the red Needs Your Decision tile and listed in its group, and its
row says what it waits on (the hold's reason) and how to clear it (lift the hold). Not oldest first: a hold stores no
wait start, so these rows sort with the group's chosen order and show no age rather than a wrong one.
A hold the person set, or an agent's hold without `--for-you`, stays in On hold exactly as today.

## Call (Mona Lisa, 2026-11-02)

Slice A, this branch: the engine's `taskState` reads `decision` for an open task held for the person, ahead of
`held`. Every surface that already reads the state (the tile count, the group, the row) then agrees with no second
rule in the page. The hold itself is unchanged: `isOnHold` still says held, so the Assigner and nudger still skip it.
The row gets one line: "On hold until you answer: <reason>. Open it and take it off hold once you have." The task
page's hold hint says the same.

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

## Review round 1 (challenge loop)

- The stale-hold nudger (engine/holdstale.js) reads the hold, not the state, and would have told the agent to lift a
  for-you hold after 2 hours of talking with the person. It now skips a for-you hold in its posts rule.
- The CLI says "on the list of what is waiting on your person" only when the board's answer carries the mark; an older
  board's answer gets its own sentence and exit 1, on Mac and Windows.
- With the agents unreadable, the warning reads "cannot tell whether more than these are waiting on you" when rows
  are listed, so it never denies them. The tile stays "?".
- Marking or unmarking an existing hold for you records a hold-set event (with forPerson when set).
- Follow-up, not this branch: the project page's needs-you count reads the roster, not taskState, so a held-for-you
  task shows there only as on hold. Goes on the slice B card.
