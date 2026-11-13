# taskaddmember-8501: give a task to a non-member in one step (--add-member)

Card: joshualeestone/kosmos#8501. The measurement and the decision are on the card (comment 6858325490).

## Problem (measured on main bad0630441, through the real routes)
- `POST /api/project/<id>/tasks` with `who` set to an agent on this board but not on the project answers 400 "that
  agent is not on this project, so the task cannot be given to it". The task assign route answers 400 "... so the part
  cannot be given to it". Nothing is stored.
- Neither answer gives a way forward. So agents give the task to someone else and message the specialist, and the
  board shows the wrong owner.
- An agent can already add a member: `POST /api/project/<id>/agent/<name>` takes process calls under the membership
  valve, recorded in memberChanges. But no CLI verb reaches it, and the refusal never names it.

## Call: (a), one step, on the board
- `kosmos task add ... --who <agent> --add-member` and `kosmos task assign ... <agent> --add-member`, in both CLIs.
  The request carries `addMember: true`, and the board puts the agent on the project and gives it the task in one
  request.
- The add follows the member route's rules for a process: the valve counts it and memberChanges records it. One rule
  is stricter: the agent must be one this board runs, so a typo adds nobody. After the add, the agent's pane gets the
  joined line, as the member route types it.
- `addMember` must be true or absent.
- Assign: the add happens after the route's own checks (task exists, part chosen, task not done), so a refused assign
  never leaves a new member.
- Task add: the add happens just before create. If create then fails, the answer says the member was added and the
  task was not (`addedMember` is in that answer too).
- Without the flag, the non-member refusal ends with ". To put <name> on the project and give it the task in one step,
  run the same command again with --add-member", but only when the name is an agent this board runs. The text has
  no double quote, because the Mac CLI reads `error` with sed.
- Both CLIs print "<name> was not on <project>, so Kosmos added it to the project first. See who is on it with: kosmos
  project show <project>" before the usual line. On `task add`, the flag without --who stops before the board (exit 2).

Rejected:
- **(b), a contributor field.** The specialist would still be off the project, so its work happens outside the board.
  It would also mean a second owner concept for the board, the CLIs and the phone.
- **A separate `project add-member` verb.** It is two steps, and the card asks for one. The member route already
  exists for anyone who wants that.

## Weakest premise
That agents adding agents to a project is acceptable. The member route already allows it from a process, under a
valve, and no ruling makes membership the person's alone (searched).

## Files
- server.js: addMemberForTask, sayJoinedForTask, withAddMemberHint; the task add and task assign routes.
- install/kosmos and tools/windows/kosmos-cli.js: the flag on task add and task assign, the added line, and help.
- tools/windows-tests.js: the new CLI test is listed as its sibling cli.task-assign-4914 is.
- Tests: server.task-addmember-8501.test.js (9), cli.task-addmember-8501.test.js (3, both CLIs against a real board).

## Proof so far
- New files: 9/9 and 3/3. 19 mutations, each one red.
- 2140 test files (task, CLI, project and member families, effectively the whole suite): 29012 tests, 28493 pass,
  0 fail, 519 skipped.
