# #9142: repeating tasks, one row per occurrence (due, delivered, and what happened to a miss)

Split from #9096 item 4 (an agent's daily feedback, 11-25): with repeating work, a late delivery can be confirmed while
its review is still pending, and the page shows the two states apart. The ask was one view per occurrence.

## Measured before building (origin/main aa377f3bd9)
- A repeating task keeps only its last run on the task; each run is a `kind: 'run'` history record (late, missedBefore).
- A missed slot the reviewer was told about is a `kind: 'missed'` record (slot, told/reached, or person).
- No per-run review exists. So an occurrence's "review" is what happened to its MISS: the reviewer was told, could not
  be reached, the person was asked, or (a miss open now, not yet recorded) not told yet / nobody set.

## Change
- engine/taskrepeat.js `occurrences(t, history, now)`: rows newest first, capped at 10, only since the current rule was
  set (as the late mark). Delivered rows: due (answeredSlot, the late mark's rule), at, late, by or person. Missed rows:
  due (slot), count, more, review (told / unreached / asked), who; plus an open miss not yet recorded (pending / none).
  The reviewer is `repeatReviewer` or `repeatReviewerPerson`. Pure, never throws.
- `occurrenceWords(row, nameOf)`: one row in words for an agent reader.
- server.js, GET /api/project/:id/task/:n/activity: `occurrences` when the task repeats and has rows (absent otherwise,
  so every other answer is unchanged); with `?words=1` each row has `words`. Never fails the route.
- install/kosmos and tools/windows/kosmos-cli.js `kosmos task activity`: after the conversation, "Runs and misses,
  newest first (when each was due):", one line each, the same on both.
- web/index.html: a "Recent runs" list under the reviewer row (#tk-occurrences, hidden when empty), painted by
  tkPaintOccurrences from the same answer, text only, a missed or late row in the missed colour; paintTaskActivity
  calls it behind a typeof guard, so tests that lift the loader alone still run.

## Rejected
- A new per-run review mark: nothing reviews runs today; inventing one is a product decision, not this card.
- Storing a run list on the task: the history already holds it, and a second copy could disagree.

## Tests
- engine/taskrepeat-occurrences-9142.test.js (6), server.task-occurrences-9142.test.js (3), cli.task-occurrences-9142.test.js
  (3, both CLIs line for line), web.task-occurrences-9142.test.js (4). Each part shown red by a perturbation or by
  main's file.
- Existing: 10 taskrepeat files (151), 42 CLI activity/parity tests, 13 page files near the change (127): all pass.

## Weakest premise
That "review status" in the feedback means the miss review. If the agent meant a reviewer confirming each delivered run,
that is a new mark and a product decision (a separate card).
