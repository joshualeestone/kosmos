# taskshow-8202: kosmos task show <project-id> <task-number>

Card: kosmos#8202 (feedback 2026-11-07: no one command prints a single task whole).

## Decision
- No new board route. `task show` reads the project's task list from the route `task list` already reads
  (GET /api/tasks?project=, with the agent's own token), picks the task by number, and prints it. It works against any
  board that lists tasks, and the agent-token rules are the list's.
- ONE renderer, engine/tasklist.js showLines, run by both CLIs (install/kosmos through `node tasklist.js show`, the
  Windows CLI through require), as the compact list already is.
- Each field is one line at the margin. Words people and agents wrote (detail, built note, checks, a part's own
  words) are printed indented, so they cannot forge a field line. EVERY string in the row is scrubbed of control and
  format characters first (review 1: the title, names and repo had not been). A webhook task is quoted as the list
  quotes it, and so is a webhook parent's title on the Under line.
- `task built --file` stores the delivered file's FINGERPRINT, never its path (engine/tasks.js builtFingerprint).
  The card asks for "delivered file paths": show prints the fingerprint and says plainly no path is kept, with the
  `kosmos fingerprint <file> <fp>` check, rather than guessing a path. Recording a path is a separate change.

## Rejected
- A new GET /api/project/:id/task/:n route: more surface (a new agent-token route) for the same fields the list sends.
- Printing raw JSON: unreadable, and a task's words would reach the terminal unquoted.

## Measured
- cli.task-show-8202.test.js: 8 tests pass (Windows lines exact, Mac lines equal Windows, webhook quoting, done
  state, refusals and usage, help on both).
- Perturbations: no indent on written words turns the exact-lines test red; no control-character strip turns it red.
- Related tests, 617 pass, 0 fail: every cli.task-*.test.js, cli.unknown-flag-4889, the files that require
  engine/tasklist, and tools.windows-kosmos-cli-verbs-parity. One existing test changed (the parity
  test's pinned Mac subcommands gain show). cli.task-assign-4914 matches the help's `list|add|assign|close`, so show
  is placed after activity in the help rather than changing that test.

## Weakest premise
That fetching the whole project's list per show is cheap enough. The list form reads no transcripts; a very large
project pays one list read per show.

## Review round 1 (decided)
- Every string scrubbed at entry (scrub); perturbed: without it the control-character test is red.
- Under prints the parent through titleOf (a webhook parent quoted); perturbed: the raw sentence turns it red.
- A hold says until what, whether the person put it on (only they can take it off), and whether it waits on them.
  The hold's reason is not stored on the task (it is said in the conversation), so show cannot print it.
- Parts: one line each, who holds it and whether it is finished, when a task has more than one.
- A webhook detail keeps its lines, each quoted, under a heading that says whose words they are; Added says "by the
  person" for a task added on the screen.

## Review round 2 (decided)
- Held and built says both (`on hold ...; built`), as the list's [on hold] [built].
- A task closed by all its parts finishing shows Closed from the latest part, as the board's closedAtOf does.
- The Commit line prints landedRepo, a path on this computer: the agent-token list already sends it, and the card
  asks for where work landed. The "no path is kept" line is about the delivered file only.

## Review round 3 (decided)
- Parts read the board's whoIsLeft: an agent that marked the task built is "reported finished" while its part is open,
  as the list says (kosmos#8137). Perturbed: without it the test is red.
- Windows refuses a project id outside the slug set with install/kosmos's own words, rather than reading a stripped id
  and printing one that does not match. Mac checks the module before reading the board, as Windows does.
- A hold until a time prints local time like the page's other times; a done-when entry that is not a string prints a
  placeholder. Tests added for replaced, paused (open and built), hold until a time, and a commit not on the remote.
