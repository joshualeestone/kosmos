# taskchatid-7185: a re-made project does not read a deleted one's history

Card: kosmos#7185 (Mona Lisa, routed by Splinter). A project's id comes from its name. Stores keyed by that id
still hold a deleted project's rows, so a project made again under the same name read them: its task 1 showed the
old task 1's conversation (a person's words included), and its room showed the old room's lines.

## Decided
- One rule, in engine/projectborn.js: a row stamped before its project's createdAt was written by an earlier project
  of that name, and no reader is given it. The rows stay on disk.
- Applied at each store's single read point:
  - engine/taskchat.js read() (task conversations; every reader goes through it: the activity route, receipts,
    undo, holdstale, retire offers, lastActivityOf, progressTimes);
  - engine/messages.js record() `rows` (the room: posts, notes, refusals, valve rows; every room reader starts there).
    `parsed` stays whole, so a hidden row's id stays reserved;
  - engine/taskseen.js seenAt() (when the person viewed a task: a re-made task 1 read the old "seen");
  - engine/messages.js lastPostAt(), which keeps its own map over the raw rows for speed: its answer is filtered
    (a room whose newest post is older than the project has had none).
- Fails CLOSED. When the projects file exists but cannot be read, every project-tagged row is left out, and record()
  answers ok:false, which every careful caller already treats as "could not read" (projectOfPost's misroute guard
  throws, the unread count says unknown). Direct messages carry no project and are untouched. The cost of that
  choice: while the projects file is unreadable, every reader that checks ok reports "could not read" for the whole
  log, direct messages included, though the log itself is fine. The room post, react and free-claim paths, which used
  rows without checking ok, refuse as could-not-read when the STAMPS are unknown (record()'s stampsUnknown), so
  nothing is posted, folded, reacted or freed against an empty room. An unreadable message LOG still fails open on
  the send path, the recorded trade above readLog (review 5 caught the first guard reversing it). The direct-message send path keeps going: its rows carry no project. A receipt is never kept from a
  read made while the stamps were unknown, and the room-held memo keys on the stamps as well as the row count.
- Cost: the stamps are cached until the projects file changes (inode, size, mtime, ctime); record()'s filtered rows
  are cached until the log or the stamps change.
- Why keep the rows: an enterprise owner owns work content (Josh, 2026-10-09) and may want a deleted project's
  history back, and projects.remove() itself says the product deletes nobody's work.
- Precedent: the webhooks (#1307) and an agent's direct thread (engine/chat.js readThread) both keep the record and
  refuse a mismatch. Those compare a stamp stored WITH the record for equality; these stores keep no stamp per row, so
  this is a time floor instead.

## Rejected
- Delete a project's rows in projects.remove: irreversible, against the enterprise ruling and remove()'s own rule.
- A new id per re-made project: ids from names are used across rooms, the CLI and URLs.
- A stamp in each file name or row: a migration of every existing store for the same effect.
- A tolerance window before createdAt: deleting and re-making within minutes is exactly how this was found.

## Stores keyed by project id, checked
- task conversations (task-chats): leaked; fixed.
- room rows (messages.jsonl): leaked, measured through the real /api/project/:id/room route (the deleted project's
  room line showed in the new room's text view); fixed.
- task seen marks (task-seen): leaked a false "seen"; fixed.
- the task list: lives in the project record, which remove() deletes; a re-made project starts at task 1 with only
  its own created row (measured).
- receipts (task-receipts): a kept receipt is reused only when its closedAt equals the task's; a new task's differs.
- webhooks: removed with the project and refused by createdAt (#1307).
- an agent's direct threads (chats): refused by projectBornAt (chat.js readThread).
- roomhold: forgotten when the project is removed (engine/remove.js).
- attachments: fetched only by a random id named in a post row; hidden posts name nothing.
- activity: per agent, not per project.
- filewriters (which agent last changed a project file): a writer is named only for a file change within minutes of
  the record, so an old project's names cannot attach to a re-made project's files in practice; not changed.
- assigner-asked.json (when each project was last asked about its goal, and a hash of what it looked like): timing
  only, no one's words; a re-made project may be asked a little later than a new name would be; not changed.

## Proven
- engine/taskchat.remade-7185.test.js, 8 tests (the eighth: lastPostAt), and in engine/messages.test.js a room post
  with the projects file unreadable is refused as could-not-read, and so are a reaction and a freed claim (each red
  without its guard). Each guard reverted on its own reds its own tests: the old
  messages.js reds the room test and the room half of the unreadable test; the old taskchat.js reds the task, progress
  and unreadable tests; a fail-OPEN projectborn reds the unreadable test; the old taskseen.js reds the seen test.
- Existing tests that wrote rows dated before the project they had just made now date the project first, in six
  files: engine/messages.test.js (the #3564 seed); server.room-held-5800.test.js (a madeLongAgo helper for three route
  tests, folder files included so they do not read as fresh work); server.projects.test.js (#1895);
  server.room-paged-7032.test.js (three projects, found by review 3); server.roomread-seen-4926.test.js (one before
  hook, two projects, review 3); cli.task-activity-5874.test.js (#6947, found by the sweep). No real row can predate
  its project: createdAt is written only by projects.create, and external rows are stamped on arrival. The final
  check is a sweep of every test file that touches the room log, task chats or seen marks.

## Weakest premise
That every row a project writes is stamped at or after its createdAt (same clock; a project exists before anything
is written to it). A clock stepped back between the two would hide a real row; so would a projects file restored from
a backup with a later createdAt.

## Not changed / not claimed
- A project id with no record, or no valid createdAt, keeps every row, as before. A deleted project's rows are
  reachable only through a project of that id, so they show again only when one exists.
- Reactions, claims and read cursors that name a hidden post now name nothing; accepted (the post is not this
  project's).
- Restoring a deleted project (same id, its own older createdAt) would show its rows and the re-made one's together;
  project restore is not built today.
- readAll() sets projects' read-ok flag as it always does; a read made here reports the file's real state.
- Counts over a window (confirmed new posts, suspected misroutes) drop a deleted project's posts once a project of
  that name exists again; accepted, they were not this project's.
