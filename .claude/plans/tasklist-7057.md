# kosmos#7057: open and stale tasks across every project, in one command

Branch `tasklist-7057`, worktree `~/work/kosmos-tasklist-7057`. Ice Cream Kitty, 2026-10-24.

## The ask (feedback, paraphrased on the card)
Reviewing task lists in a mature project is slow: built and done history fills the output and an open item gets
lost. `kosmos task list <project> --state ...` (#5705) and the compact `--open|--blocked|--built` (#6761) filter ONE
project. Missing: (a) a STALE view (open, no activity for N days), (b) the same across ALL projects. Done when an
agent can list open or stale tasks across every project in one command, and the agent instructions mention it.

## Measured live before building (2026-10-24 15:40)
`install/kosmos` cmd_task list takes exactly one project id; no stale form; no all-projects form. Same in
`tools/windows/kosmos-cli.js` taskList.

## Shape
```
kosmos task list --all                    open tasks in every project, compact (one line each, then a count)
kosmos task list --all --stale [<days>]   open tasks with no activity for <days> (default 7), quietest first
kosmos task list --all --blocked|--built  the other compact groups, across every project
kosmos task list <project> --stale [<days>]   the stale view for one project
```
Line: `<project-id>  #<n>  <state>  <owner>  <title>` (+ `quiet <N> days` for --stale), then a count line.

## Decided
- `--all` alone means OPEN, compact. The report's point is that history buries open work; an all-projects list of
  every done task would be the noise it complains about, multiplied. Rejected: `--all` = every state (the long list
  across projects). `--all --built` / `--blocked` cover the other groups.
- "Activity" is `tasks.lastActivityOf`, the board's own "Quietest first" measure (#3559): newest transcript event,
  else created; Kosmos's own missed-run, dropped-message and hold-question notes do NOT count (#4787, #5842,
  #6209). Rejected: a new definition in the CLI (two measures of the same word would disagree).
- Stale = the OPEN group only (not built, held or done): built work waits on review, held work is held on purpose.
  Rejected: stale across every group (a done task is always "quiet").
- Default 7 days; `<days>` 1 to 3650, a whole number. What would change it: a person asking for another default.
- Server (`GET /api/tasks`): `all=1` and `quietDays=N` are new params on the cheap list arm.
  - `all=1` with the board token: every project except archived ones (the Tasks view leaves them out too).
  - `all=1` on an agent token ALONE: the projects that agent is on (the same rule as the per-project read, the
    every-record rule), never the global set. The existing 403 without `project=` stays for a call without `all=1`.
  - `quietDays=N`: the open group only, each row with `lastActivityAt`, quietest first; the answer echoes
    `quietDays` so a CLI can tell an older board that ignored it (the #5705 review 1 rule).
  - Cost: `lastActivityOf` reads a transcript per OPEN task, only when `quietDays` is sent.
- Printing: `engine/tasklist.js`, the one copy both CLIs run (#6761). New `acrossLines(body, state, opts)`.
- Instructions: `engine/defaults.js` gets one line where agents are told about `kosmos task list`.

## Weakest premise
That an agent on its token alone should get "every project I am on" from `--all`. It widens nothing (each of
those projects is already readable one at a time), but it is a new shape on a route whose comment says "the task
list needs ?project=". If a reviewer reads that as a security rule rather than a cost rule, the fallback is: an
agent-token-only `--all` is refused with a sentence, and only board-token callers get it.

## Tests
- server: all=1 (board token: every non-archived project; token-only: only its projects; archived out), quietDays
  (open only, threshold edge, quietest first, echoed; a Kosmos note is not activity), bad quietDays refused.
- tasklist.js: acrossLines lines, counts, webhook quoting kept, an older board refused.
- CLI parity: both CLIs accept the same forms and refuse the same malformed ones with the same words.

## Review 1 (blind, opus, 2026-10-24 15:47 CDT): 0 BLOCKER, 4 WARNING, 4 NIT, all taken
The reviewer confirmed the token-only all=1 arm widens nothing (the every-record rule, the nobody-token 403, archived
filtered after).
- W1 last activity was never tested against a transcript (every fixture's activity was its createdAt) --> two
  transcripts: one ordinary event now (leaves the stale list), one `missed` note (stays: not activity). Mutant
  (createdAt in place of lastActivityOf) now red.
- W2 the every-record rule on the token arm was not pinned --> a duplicate-id fixture (agent on one record only: both
  records left out; the board token sees both as the control) and the nobody-token 403. Mutant (.some for .every) red.
- W3 Mac `<project> --stale` was only run against a stub that ignores the URL --> run against the real board. Mutant
  (quietDays dropped from the bash URL) red.
- W4 an older board answers a token-only `--all` with "say which project", which told the agent to name a project -->
  both CLIs say "This board is older than --all ... Update Kosmos." for exactly that refusal on --all; any other
  refusal is said as the board said it (control in the test).
- N1 a Mac engine module from before this change printed "list it without the flag" --> bash checks the module has
  acrossLines, as the Windows CLI does; tested with a pre-change module.
- N2 quietDays/all with view=tasks were silently ignored --> 400.
- N3 the #4491 comment still said "ONE project" --> it names all=1.
- N4 `--all ""` differed between the CLIs --> bash refuses it with the Windows words; in the parity test.
