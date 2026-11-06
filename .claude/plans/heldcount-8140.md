# heldcount-8140: a parent says how many of its subtasks are on hold (kosmos#8140, item 1)

## Why
A parent showed as built while most of its pieces were on hold, so a quick reader assumed the work was done. The
subtask count ({done, built, total}) had no held figure, so no screen could tell held apart from not done.

## What (item 1 only; items 2 and 3 are judged after it)
- engine/tasks.js: the tree's progress() gains `held`, the open direct children on hold (isOnHold). Direct only, like
  done and built; a held grandchild counts on its own parent.
- web/index.html: the project card chip (paintProjectTasks) and the Tasks view row chip (tskRow) say ", N on hold"
  beside "done/total", in the visible text, the title and the fold button's label. Nothing is said when N is 0, or
  when an older board sends no held figure.
- install/kosmos and tools/windows/kosmos-cli.js: `task list` reads "[d/t subtasks done, N on hold]".

## Tests
engine/tasks.subtasks-3861.test.js (held counted, open only, direct only, released drops it; the old deepEquals gain
held: 0, and the #5956 held-subtask arm now reads held: 1), web.subtasks-3861.test.js (row chip text, label, title;
none held says nothing; an older board's answer says nothing), web.task-card-761.test.js (a built parent with 3 of 4
held shows "1/4, 3 on hold" beside "Task 7 (built)").
