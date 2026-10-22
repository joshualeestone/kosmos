# replaced-6923: a task can end as "replaced by #N" instead of done

Card: joshualeestone/kosmos#6923 (agent feedback 2026-10-22, split from #6501).

## Done means

`kosmos task close <project> <n> --replaced-by <m>` (and the same from the API) closes task n and records that task m
replaced it. On the screen, task n reads "Replaced by #m" (not "done"), task m's page says "Replaces #n", and the
task's history says it was replaced. Reopening task n clears the link. Tests prove each, against a plain close as the
control.

## Decisions (the card's three questions)

1. **Who may mark it:** anyone who may close a task, agents included. It is a kind of close, and closing is already
   open to agents (`kosmos task close`). A person-set repeat still blocks a process close, as today.
2. **The link:** it must name the replacing task: a whole number, a different task, on the same project (open or
   closed). Stored once, on the replaced task (`replacedBy`); "Replaces #n" on the other task is worked out from it,
   so the two can never disagree.
3. **Where it counts:** it is closed, so it never reads as waiting for review (closing already drops the built mark).
   It is listed with closed tasks but labelled "replaced", not "done". For a parent's progress it counts as closed,
   so a parent is never stuck open by a replaced subtask.

Rejected: a separate "superseded" state beside open and closed (every reader of closedAt would need to learn it, and
a missed one would show it as open); letting it name a task on another project (no link to follow).

## Build

1. engine/tasks.js: close(projectId, n, { replacedBy }) validates inside the same mutate, stores replacedBy, records
   it on the `closed` history row; reopen and a plain close clear it.
2. server.js: the close route reads an optional JSON body { replacedBy } (no body is a plain close, as every older
   caller sends); a value that is not a whole number is refused.
3. install/kosmos and tools/windows/kosmos-cli.js: `--replaced-by <m>` on task close.
4. web/index.html: the card label, the task page's status, "Replaces #n", and the history line.

## Weakest premise

That "closed but labelled" is enough for the person. A view that only reads closedAt (a count, a filter) still counts
a replaced task as done.
