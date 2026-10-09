# builtguard-5705 slice 1: kosmos task list grouped by state (kosmos#5705 part 2)

## Done looks like
`kosmos task list <project>` on Mac and Windows lists open work first, then built, on hold, done (each newest first);
`--state open|built|held|done` keeps one group; an empty group says so; an older board that ignores --state is
refused, never passed off as the group. Other callers of /api/tasks are unchanged.

## Decided
- The board groups (?order=state, &state=, a listState echo), so the two commands cannot order differently.
- The board's Tasks view already groups by where the work is (#3559): no page change.
- A row's group follows the marks the list prints: done, then on hold, then built.
- Slice 2 (the built guard) is a separate PR. Weakest premise here: that agents reading the list for "the task I
  just added" still find it (it is open and newest, so it still prints first).
