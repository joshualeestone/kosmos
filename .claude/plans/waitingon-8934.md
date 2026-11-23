# waitingon-8934: a built task says what it is waiting on

Card: kosmos#8934 (from agent feedback, four installs). Decision posted on the card 09:4x CST 11-23.

## Problem
A task marked built means "delivered and waiting", and nothing a screen or a count can read says waiting on WHAT.
The free-text built note can say it, but it is words: the Tasks row, the text list and the people told of the mark
cannot tell which delivered work waits on the person and which waits on the agents. The text list says every built
task "waits on a review and close", whatever it really waits on.

## Change
One optional, fixed field on the built mark: `builtWaitingOn`, one of `person`, `review`, `release`. A mark can also
send `none`, which is never stored.

engine/tasks.js `setBuilt(..., { waitingOn })`, every rule:
- Validated against WAITING_ON plus `none` before anything is read; anything else refuses and writes nothing.
- In BUILT_FIELDS, so a clear and a close drop it.
- An agent's later mark without a value keeps it, as a checker's mark keeps the fingerprint (review 2: the usual next
  mark is a checker's). A mark with a value replaces it. `none` drops it and keeps the rest of the mark (review 4: a
  clear also drops the commit and the check reports). The person's own mark drops it. Review 8: another agent's mark
  on a task waiting on a review IS that review, so it does not keep `review` (it keeps `person` and `release`).
- A CORRECTION of the wait (review 5, 6 and 7): a mark by the agent whose mark it is, sending only `--waiting` or
  `none`, with no note, no file and no commit. It keeps that agent's note and file (the file is not counted as checked by its own
  sender), keeps the mark's time, and writes no second "marked it built" history line. A checker's `--waiting` is not
  a correction, so it never borrows the builder's note.
- `waitsOnly`: a mark that changes nothing but the value. It shares one condition with the "same mark again" test
  (sameButWaits, evaluated once). The route then sends no typed notice, no phone notice and no community prompt. The
  built-marks valve still counts it, so a looping corrector is throttled.

server.js `POST /api/project/:id/task/:n/built`: `waiting_on` from an agent only; the screen sends none. Review 8: no
phone "ready" notice for a mark that says it waits on a review or a release (the notice says "waiting for your
check"), and the answer carries `waitingKnown: true`, so a CLI names --waiting only to a board that keeps it. The notice to
the people the work goes to says what it waits on, a fixed phrase from an own-property table.

install/kosmos and tools/windows/kosmos-cli.js: `kosmos task built ... --waiting person|review|release|none`, checked
before the board in the same order in both (an unknown value as it is read, a missing value after --file and
--commit, --clear takes none). The confirmation says the value the board answered with (sent now or kept), and says
when an older board did not record it (never for `none`). After a mark that changed something on a task that waits on
nothing named, a last line names --waiting, since the working rules have no room for it, and only when the board's
answer says waitingKnown (review 8: against an older board, the advice would drop the note). `--waiting` has its own help
line under `task built`. The `[built]` list tag names the value.

engine/tasklist.js (what agents read): State and Built say "waiting on the person / a review / a release", a held
built task too; the --all rows say "waits on the person" or "waits on a release", and "waits on a review and close"
for review and for a mark that says nothing (the old default).

web/index.html: the Tasks row and the task page say "waiting on you", "waiting on a review", "waiting on a release".
The project card says "Built, waiting on a review / a release", and "waiting for you to check it" for the person and
for a mark that says nothing (that card's default since #6501, kept on purpose).

engine/taskguide.js (`kosmos task --how`): when to use each value, that it stays through later marks, `none`, and the
exact form of a correction. The working rules are size-budgeted (kosmos#8735), so they gain nothing.

## Not in this change (said on the card)
- Item 2 of the card (no idle nudges while built): already true (#3951, #7869).
- Item 3 (how long it waited, whether the person opened it) and item 4 (one rolled-up wait on a parent): views that can
  read this field later. So engine/agentnudge.js's parent nudge and the web parent rollup ("all subtasks built, ready
  for you to check") still say the person, whatever each subtask waits on.
- The iPhone app (ios/Kosmos/TasksLogic.swift, TaskPageLogic.swift) builds its own built lines and does not show the
  value yet: a follow-up card.
- The task conversation's built event does not carry the value (every screen and list does).
- The Built group's explanation on the Tasks page still says "waiting to be released or checked", true as the default.
- No new count: projectview's "N waiting on the person" counts members with a question, a different thing (#8917).
- A built task waiting on the person stays in the Built group; it is not moved to Needs Your Decision.

## Review
Eight blind rounds (opus, sonnet, fable in turn), the cap. Round 3 raised the only BLOCKER (the browser check's plain
mark had become the same mark again), measured red before its fix and green after. Round 8 raised three WARNINGs and
no BLOCKER; they are fixed in the last commit, each red under a mutant, with no blind round after them.

## Weakest premise
That three values cover what agents mean ("waiting on another agent's work" is not among them; free text still goes in
the note). And (review 6) that a correction from review to person needs no notice: it is the one moment the work starts
waiting on the person, and the row says so, but nobody is typed to or buzzed.

## Tests
server.builtwaiting-8934.test.js: each value stored; unknown values refused with nothing written; a later mark, a
checker's mark and the person's mark; `none`; a correction keeping the note, the time, the history and the sender's
file, with a plain mark and a new note as controls; a checker's `--waiting` borrowing no note; the route and the screen;
tasklist show and --all rows; the web helper; both CLIs (the value, the hint's three conditions, refusals and their
order, `none`, an older board through a proxy). Also server.builttell-6330 (the typed notice, and a correction typed to
nobody), web.task-card-761 (the project card), tools.windows-kosmos-cli-570 (exact output), server.communitytaskdone-5313
(the prompt's guard), and docs/browser-checks/render-tasks-view-3559.js (the Tasks row, and none back to the plain row).
