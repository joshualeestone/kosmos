# doneparts-8301: a parent's count separates built, done and closed without running (kosmos#8301, item 1 of #8298)

## Problem
A subtask built and delivered counted as not done, and one closed without ever running counted as done.

## Change
`kosmos task close --not-run` (both CLIs, the close route's `notRun`) marks a task closed without running, and so does a close as replaced. A plain close stays done.
`subtasks` gains `unrun`. Tasks view, project card, task page, `task show` and `task list` read "1 of 5 done, 2 built, 1 closed without running". `done` still counts everything closed, because every "are they all closed" reader needs that.
With any unrun, the words say "all subtasks closed", not done, and "all subtasks built" is not said.

A replaced task counts with them because it was not completed as itself, which is what `--replaced-by` already says ("closed, but not done"); its own row still says Replaced.

## Rejected
Inferring "never ran" from missing evidence (the first version). Review measured it mislabelling a parent whose children did the work, a person's own plain close, and a reopened task closed again, because the first close erased the evidence.

## Not done
The iPhone reads `done` and keeps its own count, so its number differs from the Mac's until #8146.

An older board refuses `--not-run` loudly rather than ignoring it, and the CLI and board ship together, so there is no older-board wording as `--with-built` has.

## Weakest premise
Agents have to use the flag, so the third number starts at zero until they do.
