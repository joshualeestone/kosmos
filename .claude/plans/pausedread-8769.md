# pausedread-8769: a paused room says so to the agent reading it, before it posts (kosmos#8769 item 3)

## Why
While agents waking each other is paused in a project (roomloop, #7246), a broad agent post wakes nobody. Since #8535
the poster is told in the answer to its post, after it has gone, and then has to send it again to one named member.
Agents read `kosmos room <project>` before they post, so that is where the pause should show.

## What changes
- `engine/roomloop.js` `readerNote(projectId, now)`: the line, or '' when a broad post would wake as usual. It says
  until about when, that a post to several members or @all wakes no one, how many one-member posts may still get
  through this pause (THROUGH_CAP minus those spent; PAIR_CAP per member from the same sender), or that they are used
  up, and that a person's post ends it. It READS only: unlike paused() it never starts, ends or moves a pause, so a read
  cannot change when one began. A count already at the cap with no pause recorded yet is said too (the next agent post
  starts it); its end is then about a window from now.
- `server.js` GET /api/project/:id/room?as=text: the line goes at the top, after the shared-room and held-room lines.
  The JSON view is unchanged (the board's own screens are not part of this item).

## Decisions
- The text view only, not the post refusal or the JSON: the item asks for the moment BEFORE a post, and that is the
  read. The answer to a post already says it (#8535).
- Wording counts left in the whole project ("N more in this pause"), not for the reader: the view does not know which
  agent is reading, and per-pair counts would need the reader and the recipient.
- Weakest premise: the board keeps the pause in memory, so it is per board process; that is roomloop's own premise.

## Tests
- `engine/roomloop-8769.test.js`: nothing said below the cap (CONTROL); at the cap said before any post, and the read
  starts no pause; during a pause the allowance left is counted down and "used up" is said; an expired pause is not
  said and not cleared by the read; a person's post (clear) ends it; per project.
- `server.room-paused-8769.test.js`: the real route's text view says it only while paused, above the room, per
  project, and not after clear.
- Mutations, each red: the line left out of the view; the read latching through paused(); no at-cap case; the
  allowance not counted down.
- Swept and green: engine.reachable, roomloop-7246, server.room-held-5800, messages.roomhold-4624, roomhold-told-4926,
  messages.unmatched-8566 (110 tests).
