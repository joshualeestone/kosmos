# whoisleft-8137: a task with several agents says who has finished (kosmos#8137)

## Problem
With two or more agents on a task, one marking it built does not finish it for the others. That is the design and it
works, but no screen shows it. An agent learned the rule from a nudge that kept coming after it thought it was done, and a
person reading the list cannot tell whose part is open.

## Finished means
On a task with several agents, the project column, the Tasks tab row, the task page, the iPhone's two screens and `kosmos task list` all say who
has finished and who has not, in plain words. `kosmos task built` says who is left. The nudge names the others. A task with
one agent reads as it does today. A card closes when a person has read it right on a real task.

## Change
- engine/tasks.js `whoIsLeft(task, members)`: the one rule. Finished is every part closed, or named in builtWho.
- On rows: allTasks and joinTaskClaims' withParts send `whoIsLeft` only when there is something to tell apart.
- server.js built route: `stillToFinish`, a sentence, before `summary` (the CLI reads summary as the last key).
- Words: "Reported finished: Rex. Still to finish: Amy." on the board and iPhone; a lower-case line in the CLIs.
- iPhone row: its own Text with no line limit (review 4): on the row's two-line text a long built note would cut it off.
- Long CLI list: on its own indented line, as done-when, so a task's words cannot print it. Compact list: on the row.

## Decided
- One server field, no client works it out. Rejected: each surface deriving it from parts and builtWho, four copies of a
  rule that must agree with the nudge. A test holds it to assigner.hasOpenWork on every shape.
- null when the person marked it built: that frees everyone, "Marked built by you" already says so, and "Finished: Rex"
  would claim work nobody reported.
- null on a repeating task: its parts are per run.
- An agent who left the project is not counted; offProject already names them.
- On hold or in a paused project it still shows (review 1): the part really is open, the row says it is held, and the
  nudge skips those tasks anyway. hasOpenWork answers a different question, who is busy now, so the agreement test covers
  live tasks only.
- One line, so no design handoff (the card's limit). Mona Lisa can move it; it is one element.
- "Reported finished", not "Finished" (review 6): a mark never closes a part, so the State row above could read "0 of 2 parts
  done" beside "Finished: rex", and "Finished" could read as accepted. It says what the agent reported.
- Not on the iPhone Today screen's built rows or the Windows-only surfaces beyond the shared page: the card names the task
  list and the task page. Today is a summary; left for a card if anyone asks.

## Answers the card asks for
- What `kosmos task built` printed to an assignee with others left: nothing about them. Now: "Your part only. Still to finish: amy.", to a named marker who holds a part (not an unnamed mark, which covers nobody, nor a checker), in the real route's test.
- Whether the nudge named who is still open: no, only who had marked it. Now it does.

## Limits
- A real route test and a real sandbox board. Not yet seen on a phone or by a person on a real task.
- The compact list prints it on the task's own line, where a task's words could print a lookalike. The long list uses its own line.
- A task with an open part nobody holds, and everyone counted finished, shows no line rather than "Finished", which would read as all done.
- Windows app's own view is the same web page; the Windows CLI is covered by a test, not run on Windows here.

## Weakest premise
That a person reads "Reported finished" as intended. It is longer than the card's "finished", and only a person reading
a real task can say. One string in each of five places, so cheap to change.
