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
  (fails open, the pre-#7185 behaviour). The unreadable answer is cached against the file's stat for 5 s only
  (UNREADABLE_KEEP_MS), so a passing read error on a good file is retried rather than kept until the file changes.
- messages.sweepUnanswered does nothing while the stamps are unknown: it ACTS on rows (types a nudge, writes a row),
  and would otherwise nudge about a deleted project's never-answered ask.
- messages.record(): `ok` reflects the LOG only; `stampsUnknown` still reports the projects file. The three refusals
  go. lastPostAt no longer answers undefined for unknown stamps.
- receipt: still never keeps a receipt from a read made with unknown stamps (unchanged code, comment updated).
- taskchat / taskseen: comments only (they read through olderThanProject, which now keeps rows).

## Accepted cost
While the projects file is damaged, a re-made project's predecessor rows show again. Showing a room is better than
silencing every room; the Projects page reports the damaged file. Also accepted (pre-#7185 behaviour, narrow): the
"which room did you mean" check and the room valve count a deleted project's posts from the last hour while the file is
damaged, so a project deleted and re-made within the hour of the damage can see one extra hold. Likewise the #4580
fold: a post identical to the same sender's post in a deleted same-id project, inside the fold window, reads as a
retry of it while the file is damaged. And a reaction or freed claim given a deleted same-id project's post id writes its
row against that post (orphaned and unseen once the file reads again). And the room's "no reply yet" markers (server.js,
from unanswered()) are not drawn while the file is damaged: unanswered() answers nothing then, because the sweep acts on
it; a missing marker is a display loss for the length of the damage, never a wrong nudge.

## Readers that ACT on or KEEP rows: gated while the stamps are unknown
receipt keep (before and after its read), messages.sweepUnanswered and unanswered(), undo.plan (before and after its
read; apply plans through it), holdstale.owed. Loops over projects.readAll() are gated naturally while the file is
truly damaged (it throws).

## Tests
messages.test.js: for an all-NUL file and a truncated file, a room post is PLACED and the room reads whole, with a
good-file control post; a reaction lands and a freed claim answers the same as with a good file. taskchat.remade-7185:
the unreadable case now shows the rows and reports stampsUnknown.
