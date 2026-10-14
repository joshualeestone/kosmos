# kosmos#6157 slice A: kosmos task reopen, and who put a task back and why

## Measured first (origin/main)
`tasks.reopen()`, `POST /api/project/<id>/task/<n>/reopen` (the person; a token-named agent on the project) and the
task page's reopen control already exist. Missing: a CLI verb, and the `reopened` line said neither who nor why.

## Change
- engine/tasks.js `reopen(projectId, n, { by, person, why })`: the `reopened` line carries `by` (an agent),
  `person` (the screen) and `why` (whitespace folded, REOPEN_WHY_MAX 300, longer is refused, never cut).
- server.js reopen route: reads an optional `{ why }` (no body or not JSON is a reopen with no reason; a non-text
  `why` is a 400), passes the agent its token named and whether it came from the screen. Close is unchanged.
- install/kosmos and tools/windows/kosmos-cli.js: `kosmos task reopen <project> <n> ["why"]`, words after the number
  are the reason, any --word refused, `--` lets a reason start with one; help, usage and the unknown hint list it.
- The activity line (engine/taskactphrase.js and the page's copy): "Mara put it back: <why>", "You put it back".

## Decided
- An agent that sends no token stays unnamed on this route (its existing rule); such a reopen records no `by`.
- Slice B (the Needs your decision hint: which agent, and why) is separate.

## Weakest premise
That agents reopening through the CLI carry a token. The CLI sends KOSMOS_AGENT_TOKEN when set (as close does); an
agent without one gets an honest unnamed line.

## Evidence
- cli.task-reopen-6157.test.js, 7 tests: both CLIs reopen with and without a reason (number and history kept, by and
  why recorded, the task can be given again); bad forms exit 2 before the board; a non-member is refused; the route
  records the person from the screen and nobody for an unnamed caller, refuses a non-text and an over-cap reason (at
  the cap passes); an already-open task records nothing; the words.
- Nine mutants, each reds a test.
- Pinned lists updated: the verbs-parity parser guard, the Windows unknown-subcommand hint; phrase parity samples.

## Review
1. opus: no blocker. WARNINGs fixed: the done-task assign refusal (the one the feedback met) now says "put it back
   first with kosmos task reopen <project> <n>" (not for a closed part of an open task, where it would not help);
   the Mac CLI's JSON escaping is now tested (quotes, backslashes, newline, tab, non-ASCII through both CLIs; removing
   either escape reds it). Also: a non-JSON body is a reopen with no reason (tested); the body cap is 8 KiB; the
   card's comment corrected to the positional reason. Left as NITs: UTF-16 length counting, control-byte drop vs
   space between the two CLIs, "Put back" printed for an already-open task (as close does).
