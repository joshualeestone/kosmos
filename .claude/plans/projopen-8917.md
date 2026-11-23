# projopen-8917: one meaning of "open" on a project, and --all --state (kosmos#8917)

Finished looks like: every task count `kosmos project show` and `project list` print uses the task list's own groups and
words, so each number is what `kosmos task list <id> --state <group>` lists; `kosmos task list --all --state
open|built|held` lists what --open, --built and --blocked list, on both CLIs; and item 2 (a large brief read as "no
brief") is reproduced or shown not to reproduce on current code, with the evidence on the card.

## Item 1: "open" meant two things (built)
`project show` said "Tasks: 5 open (2 built), 3 done", counting every task not closed as open, built and held included.
`kosmos task list --state open` lists only tasks not built, not held and not closed. So "no open tasks" from one meant
nearly the opposite of the other.
- engine/projectview.js openTasks adds `groups` {open, built, held, done}, counted by tasks.listGroup, the rule the task
  list uses (a paused project's tasks are held unless built, as the list holds them). `open` and `built` stay as they
  were, for older readers and this file's own callers (quietExcused reads `open` as "not closed").
- taskLine prints the groups in the list's order and words: "1 open, 1 built, 2 on hold, 1 done". "open" always shows;
  a group with none is left out. An older board sends no groups and keeps the old words.
- Both CLIs print through this one engine function, so Mac and Windows change together.

## Item 3: --all refused --state (built)
`task list <project> --state open|built|held|done` worked; `task list --all --state built` was refused ("After --all:
nothing (open tasks), --blocked, --built, or --stale"). Both CLIs now read `--all --state open|built|held` as --open,
--built and --blocked before their own checks, so the request is --all's own. `--all --state done` is refused with where
a project's done tasks are (every closed task of every project is not an --all group). The "After --all" refusal and the
help name the new form. The Mac block uses if, not case: the verb-parity guard reads a case in the task function as a
list of subcommands.

## Item 2: a large brief read as "no readable brief" (measured, not built)
- engine/brief.js reads BRIEF.md up to 256 KB (MAX_BYTES) with its goal and done kept: measured at 40, 70 and 200 KB.
  Over 256 KB it is not read and says why: `project show` prints "Brief: BRIEF.md is 601 KB, over the 256 KB Kosmos
  reads" (#8663, 11-17).
- #8663 is in 0.8.11, 0.8.12 and 0.8.13 (git ancestry), so the reporter's board (0.8.14) had it.
- The goal and done that project show, the assigner and the server read go through brief.js. engine/projects.js has two
  readers of its own (review 1): one with the same 256 KB limit, one (fillDone's) with none; neither prints "no readable
  BRIEF.md". That sentence prints only at engine/projectview.js renderShow, for why 'missing' (no file, or a folder path
  that is not absolute) or an older board that sends no reason.
- "There is no readable BRIEF.md in the folder" prints only when no file is at that path (why 'missing') or an older
  board sends no reason. So on current code a large, well-formed brief does not read as "no brief".
Weakest premise: the report's board read a different folder than the one the brief was in (a moved project folder, or
the brief saved under another name); I cannot see that board, so that is a reading, not a measurement.

## Review r1 (opus): fixed
- WARNING the Mac read --state before the agent-token check, Windows after: the same input got different words. The Mac
  block now runs after the token check; a both-CLI case (--mine --state done, no token) pins it.
- WARNING the --state refusals said "--all" for --mine forms. They now name the form typed (--mine, --all --mine,
  <project-id> --mine); a test runs both CLIs with an agent token and compares their words.
- NIT words after `--state <group>` were refused as --blocked/--open; now "--state held takes nothing after it".
- NIT the help line overclaimed (the across list still says "blocked"); now "the same lists, by the --state names a
  project's list takes".
- NIT the plan's sentence about brief readers (corrected above).

## Decided
- Use the task list's words in the summary rather than renaming the list's "open": the list's four groups are what
  agents filter by, and the summary is the line that drifted.
- "on hold" in the summary line, "held" in --state: the list's rows already print [on hold], and --state names groups.

## Tests
- engine/projectview-open-8917.test.js: the groups equal tasks.listGroup's counts on one task of each kind (open, built,
  held, built and held, done), a paused project, and an older board's words. Red on main's projectview (2 of 3; the
  older-board case passes there by design).
- cli.task-list-across-7057.test.js: --all --state open|built|held lists what --open/--built/--blocked list, both CLIs,
  from the real board (red on main's CLIs: "After --all: nothing ..."); --state done and a wrong group refused with the
  same words on both.
- engine/projectview.test.js: three assertions moved to the new words.
- 930 tests green: every cli.task*, cli.project*, cli.*help*, tools.windows-kosmos-cli*, the projectview tests and the
  fixture, name and brand guards.
