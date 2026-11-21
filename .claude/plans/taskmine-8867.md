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
- Help line for the new form in both CLIs, and a clause in `kosmos task --how` (engine/taskguide.js).
- The board adds each row's activity note (the `listing` pass) for a one-project mine list too, so its rows read as
  --mine's ("(last activity ...)"); it costs one transcript read per open row of the caller's own tasks there.
- A flag in the project's place (`--open --mine`) is refused as words out of order, not sent as a project called
  "--open".

## Decided
- Filter, not refuse: the board already had the filter; only the project pairing was refused.
- The form reads the same words as --all --mine (open by default, or --blocked, --built, --stale [<days>]), not the plain
  project list's --state groups, so "of yours" always prints its count line. Weakest premise: an agent may expect
  `<project> --mine --state done`; that is refused (not ignored), and the reason names the forms that work.

## Tests (cli.task-list-mine-7992.test.js)
- Engine: one project with mine ("of yours in"), none, stale; an older board that ignored mine=1 refused.
- Board: project=&mine=1 keeps the caller's tasks and says mine (control: without mine lists everyone's); a project the
  caller is not on lists none of its tasks as the caller's (control: without mine lists them); neither all nor project
  refused.
- Windows and Mac: `<project> --mine` lists only the caller's (control: the plain list still lists another agent's);
  --blocked, --stale; `--mine` elsewhere refused (--state, --stale, twice, --all --blocked --mine); an unknown word after
  it names the form typed; no agent token refused; an empty project word refused (it is, by the existing first-word
  check: measured before this branch's tests pinned it).
- Older board: the Windows CLI against a stub board that answers the 0.8.13 board's exact refusal; the Mac CLI's
  older-board case line run from install/kosmos itself with the same words (a stub cannot pass the Mac CLI's check
  that the answering board is this Kosmos).
Against main's four source files the first version of these tests failed 5; on this branch all 10 pass.
