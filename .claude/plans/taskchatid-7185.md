# taskchatid-7185: a re-made project does not read a deleted one's task conversations

Card: kosmos#7185 (Mona Lisa, routed by Splinter). A project's id comes from its name, and task conversations are
stored by (project id, task number) in engine/taskchat.js. Delete a project and make one with the same name, and the
new task 1 read the old task 1's conversation, a person's words included.

## Decided
- engine/taskchat.js read() keeps only rows whose `at` is at or after the project's createdAt (bornOf). Every reader
  goes through read(): the task activity route, receipts, undo, holdstale, retire offers, and progressTimes (which
  looks the stamp up once for all its files).
- The old rows stay on disk. An enterprise owner owns work content (Josh, 2026-10-09) and may want a deleted project's
  history back; nothing here deletes it, matching remove()'s own rule that the product deletes nobody's work.
- Same rule as webhooks (#1307: a webhook carrying an older createdAt is refused) and agent threads (chat.js readThread).

## Rejected
- Delete a project's task conversations in projects.remove: irreversible loss of a person's words, against the
  enterprise ruling and remove()'s rule.
- Give a re-made project a new id: ids from names are used across rooms, the CLI and URLs; far wider than the defect.
- A creation stamp in the file name: needs a migration for every existing project's files, for the same effect.

## Proven
- engine/taskchat.remade-7185.test.js, 4 tests. Against the old taskchat.js exactly the two discriminating tests fail
  (the re-made task 1 shows the old message; progressTimes counts the old task). As committed, 4 of 4.
- The 29 engine test files that read task conversations (taskchat, receipt, undo, hold, tasks, limittask,
  missedtell): 370 of 370.

## Weakest premise
That every row a project writes is stamped at or after its createdAt. record() stamps `at` with the same clock that
stamped createdAt, and a task is made after its project; a clock stepped back between the two would hide a real row.

## Not changed / not claimed
- A project id with no record (or no valid createdAt) keeps every row, as before.
- Restoring a deleted project (same id, its own older createdAt) would show its own rows and the re-made project's
  rows together; restore is not built for projects today.
- An agent's direct thread already handles this case the same way (engine/chat.js readThread, the project's createdAt,
  nothing deleted), which this follows. The project room's posts (engine/messages.js) are not measured here.
