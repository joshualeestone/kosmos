# repeatui-4787: #4787 slice 1b, setting a repeat from the task page

Slice 1 (#5389, merged) gave agents `kosmos task repeat` / `ran` and the Tasks list's repeat line. This slice gives the person the same, on the task's own page.

Built:
- A Repeats control in the task page's "This task" column: Never, Every hour, Every day (a time), Every week (a day and a time). Save lights up only when the choice differs from what is stored; an empty time is no choice. Hourly from the screen runs on the hour (an agent can set another minute from the command line).
- Under it, the board's own sentence: the rule, the last run, the next run.
- The controls follow the stored rule unless the person has an unsaved choice; another task always starts from its own rule.
- taskrepeat.fieldsOf: the one derivation of the repeat words, now also on the projects list, which the task page reads. A task its parts closed has no next run.

Not in this slice (on the card): the line in the agents' instructions (a measured block: claude -p first), and slice 2, the missed-run alert. Left as is: a person's Save clears a "marked built" mark, as slice 1's engine does.
