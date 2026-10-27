# #7367: a damaged projects file must not silence every room

**Posture:** production

## Problem
#7185 (engine/projectborn.js) hides room and task rows stamped before their project's createdAt, so a deleted-and-re-made
project does not read its predecessor's words. It failed CLOSED: with the projects file unreadable or unparseable,
every project-tagged row was hidden, and messages.sendPostWithDelivery, react and freeClaim refused with "we could not
read this room right now". One torn file (a crash can leave a JSON store all-NUL on Windows) therefore stopped every
agent talking, where before 0.7.70 it only broke the Projects page.

## Change
- projectborn: when the file exists but cannot be read or parsed, `ok` is false and `earlier()` is false for every row
  (fails open, the pre-#7185 behaviour). The unreadable answer is cached against the file's stat like a good one.
- messages.record(): `ok` reflects the LOG only; `stampsUnknown` still reports the projects file. The three refusals
  go. lastPostAt no longer answers undefined for unknown stamps.
- receipt: still never keeps a receipt from a read made with unknown stamps (unchanged code, comment updated).
- taskchat / taskseen: comments only (they read through olderThanProject, which now keeps rows).

## Accepted cost
While the projects file is damaged, a re-made project's predecessor rows show again. Showing a room is better than
silencing every room; the Projects page reports the damaged file.

## Tests
messages.test.js: for an all-NUL file and a truncated file, a room post is PLACED and the room reads whole, with a
good-file control post; a reaction lands and a freed claim answers the same as with a good file. taskchat.remade-7185:
the unreadable case now shows the rows and reports stampsUnknown.
