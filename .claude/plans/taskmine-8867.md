# taskmine-8867: `kosmos task list <project-id> --mine` filters (kosmos#8867)

Finished looks like: `task list <project-id> --mine` lists only the caller's tasks in that project and says so, `--mine`
anywhere else in the project form is refused with a reason, and the unfiltered form still lists everything.

## Measured on installed 0.8.13 (build 14c4a37364)
`kosmos task list fleetbuilders --mine` was byte-identical to `kosmos task list fleetbuilders` (2 tasks, neither mine).
In code: the Mac CLI's validation only reads options in $2 for the project form, so --mine fell through to the plain
list; the Windows CLI the same; and the board refused mine=1 without all=1 (so no CLI could ask for it).

## Built
- Board (server.js GET /api/tasks): mine=1 goes with all=1 or with one project=; with neither it is still refused.
  The existing mine filter (projects the caller is on, tasks it holds) applies after the project scope.
- Both CLIs (install/kosmos, tools/windows/kosmos-cli.js): `<project-id> --mine [--blocked|--built|--stale [<days>]]`
  is read as --all --mine's words with the project kept aside, so it asks project=<id>&...&mine=1 and prints through
  tasklist.js across. `--mine` anywhere else in the form is refused ("Put --mine right after the project ..."). An
  older board's "mine goes with all" refusal is said as "This board is older than --mine in one project".
- engine/tasklist.js acrossLines: one project with mine prints "N open tasks of yours in <project>." and "No open tasks
  of yours in <project>." (stale: "No open task of yours in <project> has been quiet ...").
- Help line for the new form in both CLIs.

## Decided
- Filter, not refuse: the board already had the filter; only the project pairing was refused.
- The form reads the same words as --all --mine (open by default, or --blocked, --built, --stale [<days>]), not the plain
  project list's --state groups, so "of yours" always prints its count line. Weakest premise: an agent may expect
  `<project> --mine --state done`; that is refused (not ignored), and the reason names the forms that work.

## Tests (cli.task-list-mine-7992.test.js)
Engine lines; board project+mine (control: without mine lists everyone's); Windows and Mac `<project> --mine`
(control: the plain list still lists another agent's task); --mine elsewhere refused; no token refused. Against main's
four source files: 5 FAIL; on this branch: 8 pass. Related task/CLI suites: 1,346 tests, 0 fail.
Not tested: a new CLI against an older board (the "older than --mine in one project" line).
