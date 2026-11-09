# doneparts-8301: a parent's count separates built, done and closed without running (kosmos#8301, item 1 of #8298)

## Problem
A subtask built and delivered counted as not done, and one closed without ever running counted as done.

## Change
`kosmos task close --not-run` (both CLIs, the close route's `notRun`) marks a task closed without running, and so does a close as replaced. A plain close stays done, and a plain close of a task already marked keeps the mark; only a reopen clears it.
`subtasks` gains `unrun`. Tasks view, project card, task page, `task show` and `task list` read "1 of 5 done, 2 built, 1 dropped" (the task page says it per row, not as a count line). `done` still counts everything closed, because every "are they all closed" reader needs that.
With any unrun, the words say "all subtasks closed", not done, and "the rest are built" instead of "all subtasks built"; the close action stays.

The count says "dropped" (Mona Lisa asked for one short word so the longest chip fits a phone line), not "skipped" or "closed without running", because a replaced task may have run. The card's third number is this one. A replaced task counts with them because it was not completed as itself, which is what `--replaced-by` already says ("closed, but not done"); its own row still says Replaced.

## Rejected
Inferring "never ran" from missing evidence (the first version). Review measured it mislabelling a parent whose children did the work, a person's own plain close, and a reopened task closed again, because the first close erased the evidence.

The chip's radius is 10px everywhere rather than a full pill, at Mona Lisa's ask: CSS cannot tell when a chip has wrapped, and at one line 10px still reads as a pill.

## Not done
The iPhone reads `done` and keeps its own count, so its number differs from the Mac's until #8146 (which is titled only for its on-hold count, so built and not-run on iPhone are still to be added there).

No not-run control on the screen: this card asks for numbers, and closing from the screen stays a plain close. A person who wants it asks an agent.

A board since #6923 refuses `--not-run` loudly; one older than that ignores the body and closes it as done. The CLI and board ship together, so only a board not updated across many releases can hit that. Review 6 asked for a warning as --with-built has; not added, because the CLI comes from the same install as the board and that path is the far edge of unreachable.

## Weakest premise
Agents have to use the flag, so the third number starts at zero until they do.

Several numbers closed with --not-run print the usual summary and do not say "as not run" per task; `task list` shows it.
