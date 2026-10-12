# reportshow-5959: an agent sees its own card, and a stale waiting state is pointed out (kosmos#5959, slice 1)

"Review N" below is challenge-loop iteration N on this branch.

## Problem
From Josh's Windows QA (#5959, #5968 items 3 and 4): an agent cannot check its own card without reading the board
directly, and a self-reported "blocked" from 09-26 sat on a card until 10-12 with nothing telling the agent.
`kosmos report show` (#2709) prints the agent's last REPORT, not what the BOARD shows.

## Change
- `engine/cardlabel.js`: the card's word as the person sees it (the page's STATE_COPY / restartingLabel / stateCopyOf,
  ported). `engine/cardlabel-5959.test.js` lifts the page's own functions and compares answers on every state and
  special case, so the two copies cannot drift.
- `GET /api/report`: the text arm starts "Your card on the board shows: <label>."; the JSON arm adds `card: { state,
  label }` and `stale`. A waiting state (needs_you / blocked) standing over a day (selfreport.STALE_WAIT_MS) gets one line saying
  how long and how to clear it. Both CLIs read the text arm, so no CLI change.

## Not done here
- The push side of item 4 (telling the agent unasked, once) is slice 3 on the card.
- Items 1 (health line) and 2 (diagnostics export) are slices 2 and 4.

## Weakest premise
That the roster card the route reads carries every field the page's label uses (stateReportedBy, crashLoop,
reconnect, disruption, modelName). safeRoster adds crashLoop and reconnect as /api/status does, and a pane card
carries modelName (status.js); a paneless card has none, so its model-switch restart reads "Switching model".

**The age is the latest line's (review 3).** Re-reporting the same waiting state, or a line rewritten over it, starts the
clock again, so "standing for N days" can only underestimate. A report Kosmos wrote for the agent (`by` auto: a
permission prompt, a provider error) is not called "your own", and is cleared only "if what it was about has passed".
The label also follows the page's OFFLINE card (running false, not restarting: a trust prompt, an unseen job's "Can't
tell", or "Not running"), which the page decides before stateCopyOf; that branch is a template, so the test pins its
expressions by text (review 4). A report an operator or an unknown writer left is said without naming a writer.
Deferred (review 6): no route-level test of a crash-looping or reconnecting card. The route's card is safeRoster's,
which adds crashLoop and reconnect with the same expressions /api/status uses; stateReportedBy is covered end to end
("Question"); the labels themselves are pinned by the parity test.
Deferred (review 8): the parity test reads the page with \n anchors; it is not in the Windows job (tools/windows-tests.js)
and Windows CI checks out with core.autocrlf false. The route's card fields remain the stated premise above.
