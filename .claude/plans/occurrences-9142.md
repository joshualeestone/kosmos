# #9142: repeating tasks, one row per occurrence (due, delivered, and what happened to a miss)

Split from #9096 item 4 (an agent's daily feedback, 11-25): with repeating work, a late delivery can be confirmed while
its review is still pending, and the page shows the two states apart. The ask was one view per occurrence.

## Measured before building (origin/main aa377f3bd9)
- A repeating task keeps only its last run on the task; each run is a `kind: 'run'` history record (late, missedBefore).
- A missed slot the reviewer was told about is a `kind: 'missed'` record (slot, told/reached, or person).
- No per-run review exists. So an occurrence's "review" is what happened to its MISS: the reviewer was told, could not
  be reached, the person was asked, or (a miss open now, not yet recorded) not told yet / nobody set.

## Change
- engine/taskrepeat.js `occurrences(t, history, now)`: one row per SCHEDULED SLOT, newest first, capped at 10, only
  since the current rule was set. A slot a run answered (answeredSlot, the late mark's rule; the first run for a slot)
  is delivered (late or not, at, by or person); a slot past its miss grace with no run is missed. Either carries a
  review (told / unreached / asked, who) only when a miss record names THAT slot. A run before the first slot has due
  null. The slot walk takes at most 10 steps back from now. Pure, never throws.
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

## Reviews
- Round 1: 0 BLOCKER, 3 SHOULD, 3 NIT.
  - SHOULD: the open-miss row double-counted a stretch a recorded miss already counts, and said "not told yet" for ever
    for an unreachable reviewer (and for paused, held or throttled tasks). Fixed: shown only when no recorded miss falls
    in the stretch, and it claims nothing about the review ("no run since").
  - SHOULD: misses a run recovered vanished on a task with no reviewer. Fixed: a row from the run's missedBefore unless
    a recorded miss covers that stretch.
  - SHOULD: a failed read left the previous task's list showing. Fixed: the list is tied to its task; a failed read
    keeps it only for the same task.
  - NIT: a projects read on every 5-second poll. Fixed: only when the history shows a repeat rule.
  - NIT: the CLIs exit at "Nothing recorded" before the block. Left: a repeating task always has created and repeat-set
    events, so the block is never skipped for one.
  - NIT: recordRun's `at` is not stored (taskchat stamps its own). Left: every caller passes now, so the two agree;
    noted for anyone who adds a caller that passes another time.

- Round 2: 0 BLOCKER, 4 SHOULD, 2 NIT, one root: rows built from the miss records' stretch counts double-counted
  (A, B), hid misses after a once-per-stall record (C), and a run before the first slot showed a made-up due time (D).
  Fixed by design, not by patches: rows now come from the schedule and the runs, one per slot, and a record only
  annotates the slot it names (no counts). NIT E (a missed slot delivered late was two rows) and NIT F (two runs for
  one slot) are fixed by the same design (one row per slot, the first run). The CLIs no longer print the run's time
  twice for a run before the first slot.

## Weakest premise
That "review status" in the feedback means the miss review. If the agent meant a reviewer confirming each delivered run,
that is a new mark and a product decision (a separate card).
