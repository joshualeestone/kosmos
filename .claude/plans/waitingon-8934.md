# waitingon-8934: a built task says what it is waiting on

Card: kosmos#8934 (from agent feedback, four installs). Decision posted on the card 09:4x CST 11-23.

## Problem
A task marked built means "delivered and waiting", and nothing a screen or a count can read says waiting on WHAT.
The free-text built note can say it, but it is words: the Tasks row, the text list and the people told of the mark
cannot tell which delivered work waits on the person and which waits on the agents. The text list says every built
task "waits on a review and close", whatever it really waits on.

## Change
One optional, fixed field on the built mark: `builtWaitingOn`, one of `person`, `review`, `release`.

- engine/tasks.js `setBuilt(..., { waitingOn })`: validated against WAITING_ON (anything else refuses, nothing
  written); stored as `builtWaitingOn`; in BUILT_FIELDS, so a clear drops it. An agent's later mark without one keeps
  it, as a checker's mark keeps the fingerprint (review 2: the usual next mark is a checker's, and dropping it lost the
  builder's "waiting on you"); a mark with one replaces it; `none` (review 4) drops it and keeps everything else,
  since a clear also drops the commit and the check reports; the person's own mark drops it. A mark that changes only
  this tells nobody again (review 4: the hint's advice would otherwise send every notice twice). Part of the "same mark
  again" comparison, so changing only what it waits on is a change.
- server.js `POST /api/project/:id/task/:n/built`: `waiting_on` from an agent only; the screen sends none. The notice
  to the people the work goes to says what it waits on.
- install/kosmos and tools/windows/kosmos-cli.js: `kosmos task built ... --waiting person|review|release`, checked
  before the board (a missing or unknown value refuses; --clear takes none). The confirmation names it, and says so
  when an older board did not record it.
- engine/tasklist.js (what agents read): "built, waiting on the person / on a review / on a release", and the
  waits-on line says the same, the default staying "a review and close".
- web/index.html: the Tasks row and the task page say "waiting on you", "waiting on a review", "waiting on a release".
- engine/taskguide.js (`kosmos task --how`): one paragraph saying when to use each value. The working rules are
  size-budgeted (kosmos#8735), so they gain no new paragraph.

## Not in this change (said on the card)
- Item 2 of the card (no idle nudges while built): already true (#3951, #7869).
- Item 3 (how long it waited, whether the person opened it) and item 4 (one rolled-up wait on a parent): views that can
  read this field later.
- No new count: projectview's "N waiting on the person" counts members with a question, a different thing (#8917).
- A built task waiting on the person stays in the Built group; it is not moved to Needs Your Decision.

## Weakest premise
That three values cover what agents mean, and (review 2) that nobody needs to set it back to "says nothing" short
of taking the mark off. "Waiting on another agent's work" is not among them. Free text still goes in
the note.

## Tests
A new engine test for setBuilt (each value stored, unknown refused with nothing written, a later agent's mark without
one keeps it, a checker's mark keeps it, the person's mark and a clear drop it, a change of only the value is a change,
the screen path cannot send it), the route and the typed notice, tasklist words (show and the --all rows), both CLIs'
option parsing (refusals with controls, an older board, the hint's conditions), the web row words, the project card,
and a browser check on the Tasks row (render-tasks-view-3559.js).
