# doneparts-8301: a parent's count separates built, done and closed without running (kosmos#8301, item 1 of #8298)

## Problem
A subtask built and delivered counted as not done, and one closed without ever running counted as done (0 of 5, then 1 of 5
after a never-run check was closed).

## Change
A close stamps `closedUnrun` when the task has no sign of work: not marked built, no commit landed, no run, no part finished.
Reopening clears it. `subtasks` gains `unrun`. The count reads "1 of 5 done, 2 built, 1 closed without running", on the Tasks view,
the project card and `kosmos task show`, and the chip's number leaves out the unrun.

`done` still counts everything closed, because every "are they all closed" reader (Close it, close-with-built) needs that.

## Rejected
Inferring from the built mark at read time: closing deletes it, so nothing is left to read. A later close has to record it.

## Not done
The iPhone reads `done` and keeps its own count (#8146).

## Weakest premise
That no recorded work means it never ran: an agent that did the work and closed without marking it built reads as closed without
running. Tasks closed before this shipped have no stamp and read as done, not guessed at.
