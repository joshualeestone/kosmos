# builtseen-7875: built tasks say whether the person has looked since (kosmos#7875, item 3)

## Finished looks like
`kosmos task list <project> --built` and `kosmos task list --all --built` (Mac/Linux and Windows CLIs) end each built
task's line with "(seen by the person since built)" or "(not seen by the person since built)", so an agent can tell
whether to raise a built task again or wait. A task the person marked built themselves says "(marked built by the person)".
Other lists are unchanged, including the long form `kosmos task list <project> --state built`, which receives the
field but prints its own layout. An older board that does not send the field gets no marker, never a wrong one.

## What already existed (measured before building)
#6947 built the record: engine/taskseen.js keeps when the person last viewed a task's conversation in Kosmos, and
`kosmos task activity <project> <n>` already says "The person viewed this task at ...". What was missing is the list
an agent scans for its built work: it showed no sign at all. So this item adds the existing fact to that list.

## Shape (decided)
- server.js `GET /api/tasks`, built list only (`listState: 'built'`): each row gains `seenByPerson` (taskseen.seenAt,
  or null). Read per built row, one small file each; the built list is short.
- engine/tasklist.js (`seenWords`, the one module both CLIs print through): seen at or after `builtAt` is "seen since
  built"; null, or a view before the build, is "not seen since built"; no `builtAt` with a view counts as seen. No
  `seenByPerson` field at all (an older board): nothing printed.
- What "seen" means is taskseen's own definition (the task's conversation drawn on the person's screen in Kosmos);
  a built task read about elsewhere (the room, a notification) does not count. Stated, not widened here.

## Rejected
- A new "acknowledged" control for the person: the ask is to know whether they looked, which the board already
  records; a new control would be a product decision and more for the person to press.
- Adding it to every list: open and held tasks have their own signals; the ask was built items.

## Tests
server.tasks-builtseen-7875.test.js: a sandboxed board, a built task viewed and one never viewed, both lists (one
project and --all), the open list as a control, and seenWords' cases. The two CLI suites that print the built list
from a real board (cli.task-list-compact-6761, cli.task-list-across-7057) now expect the marker.

## Weakest premise
That "viewed the task's conversation in Kosmos" is what agents mean by "seen". A person who reads the built note in
the project room never opens the task, so the line says "not seen" for work they did see.
