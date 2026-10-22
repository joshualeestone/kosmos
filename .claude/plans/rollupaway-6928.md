# rollupaway-6928: the roll-up's follow-ups

Card: kosmos#6928, filed when #6501's review loop stopped at the 8-round cap (PR #6935, merged as cfa004970a).

## Decided
- **A refusal on a page the person left is said, not dropped.** The roll-up ("Close them and this task") writes its
  message only on the parent's page (here(): PJ_CURRENT and TK_OPEN). When the person has moved on, a refusal, or a
  request that never answered, now goes to the board's existing page-wide toast (msgToast, held 9 s, as #6585 holds
  words someone must act on), worded for someone not looking at the task:
  - a subtask refused: "Closing task #P stopped at task #N: <the route's sentence>. Task #P is still open."
  - the parent refused: "Task #P was not closed: <sentence>. Its built subtasks are closed."
  - no answer: "Closing task #P and its subtasks did not finish. Open it to see where it stopped."
  A success while away says nothing: there is nothing to do.
- **The failed-reload branch has an arm.** The closes land, the board's project read fails (500), PJ_READ_FAILED is
  true, and focus is not moved to the top of a page that still shows the old line.
- **The roll-up arms' waits no longer swallow a timeout**, so a timeout reads as a timeout, not as a wrong message.

## Rejected
- A note kept on the parent until the person returns: new state for a rare case; the toast reaches them where they are.
- Re-pinning the reload-before-re-enable order by behaviour in the node test: the browser check's double press already
  guards it (a press without the disabled flag asks [5,5,1,1]); the source pin stays as a second line.

## Weakest premise
- That the toast is seen: it shows for 9 s on whatever page is open, and a later toast inside that time (msgToast keeps
  one element) replaces it. If the person has left the board entirely, the repainted list is still the record.

## Tests
- docs/browser-checks/render-subtasks-3861.js, at 1400 and 390: the leave-the-page arm now also reads the toast's
  words; a new arm on its own project fails the reload after the closes and checks PJ_READ_FAILED and focus.
- Mutants, each red: the toast removed (the toast arm times out); the reload always counted as repainted (focus goes to
  tk-back).

## Review round 1
- "Here" missed a tab switch: going to Agents, Tasks or Settings keeps PJ_CURRENT and TK_OPEN, so a refusal went into
  the hidden task page and no toast showed, and reopening the task cleared it. here() now also needs the Projects panel
  and the task view showing.
- The parent-refused and no-answer toasts had no arm; both now have one, each after a real tab switch (which also
  covers the fix above).
- The failed-reload arm's comment claimed focus "stays where it was"; it only asserts focus is not moved to the top
  (a disabled button drops focus), and now says that.
