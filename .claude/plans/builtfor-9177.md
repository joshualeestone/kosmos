# builtfor-9177: `task list --mine` reads built per holder

Card: #9177 (found in review of #9176, Ice Cream Kitty).

## Finished looks like
A shared task that ANOTHER holder marked built stays in the asking agent's own open list (`kosmos task list --mine`,
GET /api/tasks?...&mine=1, GET /api/tasks/mine) while its part is open, as the Assigner already counts it. A task the
person marked, or one the asking agent marked itself, is built for it. The board's task-level views are unchanged.

## Done
- engine/tasks.js: `builtFor(t, who)` (who = a name, exact, or a function given each marked name): built for that agent
  when the person marked it (builtFreesAll) or it is in builtWho. `listGroup(t, who)` and `inListOrder(rows, only, who)`
  take an optional reader; without one they read any mark as built, as before.
- engine/assigner.js (hasOpenWork, busyHold) and engine/agentnudge.js:70: the inline copy of the predicate replaced by
  tasks.builtFor (same rule, exact name match as before). agentnudge.js:103 is a different question (which OTHER holders
  marked) and runs after :70 has skipped a person-marked task, so it is unchanged.
- server.js: GET /api/tasks with mine=1 passes the caller (heldByCaller, the same matcher that picks the caller's tasks)
  to inListOrder, in the state and the quietDays paths; GET /api/tasks/mine does the same.
- server.tasks-mine-built-9177.test.js (5 tests): builtFor and listGroup units; --mine open and built for both holders
  (mirror image); one project with --mine; /api/tasks/mine; CONTROL: without mine=1 any mark is built.

## Verified
- New test file 5/5. CONTROL against origin/main's server.js and engine files: 4 of 5 fail (the CONTROL passes).
- Every test file that greps for listGroup, inListOrder, hasOpenWork, busyHold, builtWho, tasks/mine or mine=1, plus
  fixture-discipline, engine.reachable and tmpscope-first: 353/353.

## Decisions
- A mark with no builtWho list at all (made before marks named who made them) stays built in --mine: it cannot say whose
  it is, and reading it as open would bring old built tasks back onto every holder's list. builtFor itself, and so the
  Assigner, still reads such a mark as freeing nobody, as it did before this change. That one difference between the
  list and the Assigner is kept on purpose; changing the Assigner for old marks is out of scope for a list fix.
- The instructions block (tasks.forAgent) is #9176's (Ice Cream Kitty); she switches it to tasks.builtFor after this
  lands (agreed in fleetbuilders, m7091).
- Weakest premise: that heldByCaller is the right matcher for builtWho names. builtWho holds the names agents marked
  with, the same names the parts hold, and heldByCaller is what already decides which parts are the caller's.
