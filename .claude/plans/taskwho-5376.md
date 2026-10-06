# taskwho-5376: `kosmos task add` says when nobody has the task yet (#5376)

## Finished means
Adding a task without --who, from either command (Mac install/kosmos, Windows tools/windows/kosmos-cli.js), tells the
agent that nobody has it yet, that an idle agent on the project may be given it, and how to choose: a second line naming
`kosmos task assign <project> <number> <agent>`. Never said for a named owner, for a name that came back unreadable, or
for an answer that carries no who at all.

## Measured first (the card asked: is it guessing, or only unclear?)
- The board does not guess. server.js's task-add route passes `who` through resolveWhoAsked, which returns it unchanged
  when absent; engine/tasks.js create stores `who: null` (unassigned).
- What the agent saw as guessing is the Assigner (engine/assigner.js, on by default since #3595): an agent idle for 20
  minutes is given the next task nobody is on in a live project it belongs to (soonest due, then oldest). So a task
  added without --who later gains an owner the caller never named.
- The CLI's reply was the same "Task N added to P. See it with ..." either way; nothing said it went to nobody.

## Decided
- Say it in the reply, both CLIs, from the board's own answer: only when the task's first "who" is literally null.
  The Mac command already leaves the name out when it is unreadable (a backslash, #4887), so "name not said" is not
  "nobody"; the line keys on null, not on an empty name.
- Keep the first line unchanged (scripts and the #5175/#4887 tests read it); the new line follows it, before the #5319
  same-text note.
- "may be given it": true whether or not the person has the Assigner on (it is on by default; off, nothing assigns it).

## Rejected
- Making the board refuse a task with no --who: the screen and webhooks add unassigned tasks on purpose (#1307), and
  an unassigned task is a valid state the Assigner exists to serve.
- Defaulting --who to the caller: changes who does the work without anyone asking; the report wanted clarity, not a
  different owner.
- Naming the Assigner by name or checking its setting from the CLI: a second read for one sentence; "may" is accurate.

## Tests
- cli.task-nobody-5376.test.js (new): both CLIs against a real board (no --who: the line, with the real number and
  project; --who mara: no line), and stand-in answers (no who key: no line; an unreadable name on the Mac: no line; no
  number: `<task-number>`). Control: with main's two CLIs swapped in, all 4 fail.
- server.task-same-text-5319.test.js: its Mac window widened (the new comment sits between the sentence and the note) and
  its Windows arms now expect the line for who null, plus a control that a named owner gets none.

## Weakest premise
That the report's "guessing" is the Assigner's hand-out and not something else. The board path measured above is the
only place a task without --who gains an owner on its own; if an agent meant something else, this line still states a
true fact and points at the explicit way to choose.
