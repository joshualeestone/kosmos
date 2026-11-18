# checkcap-8668: task check evidence room, and --moved-to (kosmos#8668)

## The card
1. `kosmos task check ... "<how>"` refused evidence over 200 characters; agents trimmed the proof to fit.
2. No way to say where an unmet check's part went when the rest moved to a new task.
Done when: a 400-character evidence line is accepted and shows whole on the task page; an unmet check with
`--moved-to` shows the link on both tasks.

## Decided
- **Cap: 1000, counted in characters (Array.from)**, the same number and the same counting as the built note
  (BUILT_NOTE_MAX, #8352), which the card asked to match. Rejected: keeping it tied to DONE_CHECK_MAX (a check's
  sentence is a different thing from its evidence; the check sentence keeps its 200). Rejected: a separate
  number like 500 (two different "long text" limits on one task page is one more thing to remember).
- **Still one line of plain text.** The control/format-character rule is lifted into NOT_ONE_LINE_RE and shared
  by doneWhenProblem and setCheckResult, so the two cannot drift.
- **movedTo is stored once, on the reporting task's result** (`doneWhenResults[i].movedTo`), and the target task
  works its list out from the project's tasks, the same shape #6923's replacedBy uses. Rejected: storing a
  back-link on the target (two copies of one fact, and a reopen/renumber would leave one stale).
- **Only on an unmet check.** A met check went nowhere. Refused onto its own task and onto a task that does not
  exist (409, read inside the write). A stored movedTo on a met result is ignored on read.
- A closed target is allowed: a closed task can be reopened, and refusing it would make an agent reopen a task
  just to record where work went. The link reads as where the part went, not as a claim it is still open.
- Reporting the same words without --moved-to is a change (the link goes), so an agent can take a link back.
- Surfaces: engine (tasks.js), the route (server.js passes body.movedTo), the page (link on the check, a
  "Moved here from other tasks" list on the target; the row also shows for a target with no checks of its own),
  `kosmos task show` (engine/tasklist.js, both CLIs), the activity row (taskactphrase.js and its page twin), both
  CLIs' `--moved-to` (seven words exactly, unmet only, digits only), and the agents' rules (doctrine 51).

- **A refused check is named** (feedback 11-17 18:07, via Splinter): `kosmos task check` reports ONE check per command,
  so "all-or-nothing" across an agent's several commands is not something the CLI can hold. What failed was that the
  refusal said only "that check", so a long line lost one check while the others went through unnoticed. Both CLIs now
  say "Kosmos did not report check N on task T: <why>. Nothing was recorded for check N; any other check you reported
  stands." and the usage line says one check per command, one line, up to 1000 characters. Rejected: a multi-check
  form validated as a whole (new surface for a problem the message solves).

## Weakest premise
That the moved-here list belongs in the checks row. On a task with no checks of its own the row's label becomes
"Moved here from other tasks" (review 2), so it never reads as an empty "Done when".

## What would change my mind
A design review saying the moved-here list belongs elsewhere on the page (for example beside "Replaces task N" in
the state line). The data and the CLI do not change if it moves.

## Not done
- A target task cannot go missing on its own: nothing removes a task from a project (no delete path in
  engine/tasks.js or server.js; measured by grep with a control), and removing the project removes both ends.
- The Tasks list row does not show the moved-to (it shows only counts).
