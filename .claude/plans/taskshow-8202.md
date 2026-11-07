# taskshow-8202: kosmos task show <project-id> <task-number>

Card: kosmos#8202 (feedback 2026-11-07: no one command prints a single task whole).

## Decision
- No new board route. `task show` reads the project's task list from the route `task list` already reads
  (GET /api/tasks?project=, with the agent's own token), picks the task by number, and prints it. It works against any
  board that lists tasks, and the agent-token rules are the list's.
- ONE renderer, engine/tasklist.js showLines, run by both CLIs (install/kosmos through `node tasklist.js show`, the
  Windows CLI through require), as the compact list already is.
- Each field is one line at the margin. Words people and agents wrote (detail, built note) are printed indented,
  with control and format characters removed, so they cannot forge a field line. A webhook task is quoted as the
  list quotes it.
- `task built --file` stores the delivered file's FINGERPRINT, never its path (engine/tasks.js builtFingerprint).
  The card asks for "delivered file paths": show prints the fingerprint and says plainly no path is kept, with the
  `kosmos fingerprint <file> <fp>` check, rather than guessing a path. Recording a path is a separate change.

## Rejected
- A new GET /api/project/:id/task/:n route: more surface (a new agent-token route) for the same fields the list sends.
- Printing raw JSON: unreadable, and a task's words would reach the terminal unquoted.

## Measured
- cli.task-show-8202.test.js: 5 tests pass (Windows lines exact, Mac lines equal Windows, webhook quoting, done
  state, refusals and usage, help on both).
- Perturbations: no indent on written words turns the exact-lines test red; no control-character strip turns it red.
- Related CLI/tasklist tests and the verbs-parity test: 617 pass, 0 fail (two existing tests updated: the help's verb
  order kept `list|add|assign|close`, so `show` sits after activity; the parity test's pinned Mac subcommands gain show).

## Weakest premise
That fetching the whole project's list per show is cheap enough. The list form reads no transcripts; a very large
project pays one list read per show.
