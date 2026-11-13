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
- Who may: whoever may call the member route. That route is not an agent-token route, so a caller the board let in on
  an agent token alone (agentTokenOnlyCaller) is refused 403 with nothing changed, and the person can add the agent
  from the project page. A process is counted by the membership valve and recorded in memberChanges. One rule is
  stricter: the agent must be one this board runs, so a typo adds nobody.
- `addMember` must be true or absent.
- A refused task never leaves a new member. If the create or the give is refused after the add, the member is taken
  off again (removeAgent). An error after the task was created or moved does not take anyone off. Only if the
  removal itself fails does the answer say the agent stayed (with `addedMember`).
- The joined pane line is typed only after the task is given, after the task's own tell has written the project into
  the agent's instructions (the member route's order: sync, then speak).
- Assign: the add happens after the route's own checks (task exists, part chosen, task not done).
- Without the flag, the non-member refusal ends with ". To put <name> on the project and give it the task in one step,
  run the same command again with --add-member", but only when the name is an agent this board runs. The text has
  no double quote, because the Mac CLI reads `error` with sed.
- Both CLIs print "<name> was not on <project>, so Kosmos added it to the project first. See who is on it with: kosmos
  project show <project>" before the usual line. On `task add`, the flag without --who stops before the board (exit 2).

Rejected:
- **(b), a contributor field.** The specialist would still be off the project, so its work happens outside the board.
  It would also mean a second owner concept for the board, the CLIs and the phone.
- **Changing the hint's wording for older CLIs.** A CLI ships with its board, so the hint and the flag arrive
  together.
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

## Proof so far (after review round 1)
- server.task-addmember-8501: 12 pass; cli.task-addmember-8501: 3 pass. 19 mutations before review and 5 after
  round 1; every one red.
- 2140 test files before review (effectively the whole suite): 29012 tests, 0 fail.
