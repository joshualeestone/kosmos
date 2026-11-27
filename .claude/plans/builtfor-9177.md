# builtfor-9177: `task list --mine` reads built per holder

Card: #9177 (found in review of #9176, Ice Cream Kitty).

## Finished looks like
A shared task that ANOTHER holder marked built stays in the asking agent's own open list (`kosmos task list --mine`,
GET /api/tasks?...&mine=1, GET /api/tasks/mine) while its part is open, as the Assigner already counts it, and the
list says so rather than "waits on a review". A task the person marked, one the asking agent marked itself, or one
where none of its own parts is open, is built for it. The board's task-level views are unchanged.

## Done
- engine/tasks.js: `builtFor(t, who)` (who = a name, exact, or a function given each marked name): built for that agent
  when the person marked it (builtFreesAll) or it is in builtWho. `listGroup(t, who)` and `inListOrder(rows, only, who)`
  take an optional reader; without one they read any mark as built, as before. With one, a marked task is built for the
  reader when `builtForReader` says so: builtFor, or no open part of its own (`holdsOpenPart`, hasOpenWork's reading),
  or an old mark with no builtWho list.
- engine/assigner.js (hasOpenWork, busyHold) and engine/agentnudge.js:70: the inline copy of the predicate replaced by
  tasks.builtFor (same rule, exact name match as before). agentnudge.js:103 is a different question (which OTHER holders
  marked) and runs after :70 has skipped a person-marked task, so it is unchanged.
- server.js: GET /api/tasks with mine=1 passes the caller (heldByCaller, the same matcher that picks the caller's tasks)
  to inListOrder, in the state and the quietDays paths; GET /api/tasks/mine does the same. On mine answers a marked row
  that does not cover the caller (builtForReader false), and is not closed, carries `builtForCaller: false`: an open
  or held row, never the caller's own mark.
- engine/tasklist.js (both CLIs): such a row's words are "another holder marked it built; your part is still open", not
  "waits on a review and close". An older board sends no flag and reads as before.
- server.tasks-mine-built-9177.test.js (8 tests): builtFor and listGroup units (closed own part, paused, old mark,
  unnamed caller); --mine open and built for both holders (mirror image, and a reader whose part is closed); one
  project with --mine; /api/tasks/mine; the flag and the CLI words (acrossLines on the real answer); --mine --stale
  (quietDays); held rows (flagged only for another holder's mark) and an old mark through the route; CONTROL: without
  mine=1 any mark is built and no row is flagged.

## Verified
- New test file 8/8.
- 36 test files (every one that greps for listGroup, inListOrder, hasOpenWork, busyHold, builtWho, tasks/mine, mine=1,
  engine/tasklist, acrossLines or waitsWords, plus fixture-discipline, engine.reachable, tmpscope-first): 500 pass,
  0 fail, 7 skipped.

## Decisions
- A mark with no builtWho list at all (made before marks named who made them) stays built in --mine: it cannot say whose
  it is, and reading it as open would bring old built tasks back onto every holder's list. builtFor itself, and so the
  Assigner, still reads such a mark as freeing nobody, as it did before this change. That one difference between the
  list and the Assigner is kept on purpose; changing the Assigner for old marks is out of scope for a list fix.
- The instructions block (tasks.forAgent) is #9176's (Ice Cream Kitty); she switches it to tasks.builtFor after this
  lands (agreed in fleetbuilders, m7091).
- engine/tasks.js whoIsLeft (who has finished on a shared task, for the screens) reads the same facts per name and a
  members set, and already treats "every part closed" as finished; it is left as is.
- Weakest premise: that heldByCaller is the right matcher for builtWho names. For a caller identified by its key it
  matches by safe key, where the Assigner matches the exact name, so in that rare case the list can read a mark as the
  caller's when the Assigner does not (toward hiding a task from the list, never toward showing another agent's). builtWho holds the names agents marked
  with, the same names the parts hold, and heldByCaller is what already decides which parts are the caller's.
