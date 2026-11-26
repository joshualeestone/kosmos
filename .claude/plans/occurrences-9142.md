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

- Round 3: 0 BLOCKER, 2 SHOULD, 2 NIT.
  - SHOULD: a run in the early window was hidden until its slot's time. Fixed: a slot a run answered shows at once.
  - SHOULD: every run since the rule went through answeredSlot (102 ms for a year of 15-minute runs, on the 5-second
    poll). Fixed: runs older than the oldest walked slot (less its early window) are skipped; they cannot reach the rows
    shown. Tested against a plain scan timed side by side (not a fixed deadline): 1.3x with the floor, 30 to 39x without.
  - NIT: late now computed from the slot (runIsLate's rule), so an old record without the field reads right. NIT: a stale
    page comment. Both fixed.

- Round 4: 0 BLOCKER, 2 SHOULD, 1 NIT. SHOULD: a run stamped in the future made a false future "delivered" row. Fixed:
  a run more than a minute ahead answers nothing, as dueSlot reads it. SHOULD: a closed task kept growing missed rows.
  Fixed: the walk and the miss test stop at closedAt, as missedRuns does. NIT: runs are cut at the floor and records at
  the first slot; harmless, since rows older than the walk are sliced off. Left. The floor, the late mark (equal to
  runIsLate for every rule kind) and the ratio test were checked and hold.

- Round 5 (whole branch, nothing pre-cleared): 0 BLOCKER, 2 SHOULD, 2 NIT. SHOULD: opening a task left the previous
  task's runs showing while the new read loaded. Fixed: cleared in the same reset as its events (guarded: a test's fake
  element has no dataset; web.task-seen-6947 caught that). SHOULD: with a run stamped ahead, slots it answered read as
  missed while missedRuns claims none. Fixed: no missed rows are claimed then. NIT: a review with no name said
  "undefined". Fixed. NIT: closing a task deletes its repeat, so the closed-task branch never runs in production; kept as
  a guard (it agrees with missedRuns), its test documents that.

- Round 6 (whole branch, nothing pre-cleared): CONVERGED, 0 BLOCKER, 0 SHOULD. The reviewer ran the branch's four test
  files (27 of 27) and the six older page tests that lift openTaskPage or paintTaskActivity (77 of 77), and found no
  crash path (every new DOM touch null-guarded, occurrences and the route's helper both catch). A task that does not repeat
  gets byte-identical JSON and CLI output. NITs left, each matching what missedRuns already says: a reopened task's
  closed-period slots read missed; a rule changed before repeatSetAt was recorded falls back to createdAt (the late mark
  has the same limit); a run stamped ahead hides missed rows until the clock passes it.

## Weakest premise
That "review status" in the feedback means the miss review. If the agent meant a reviewer confirming each delivered run,
that is a new mark and a product decision (a separate card).
