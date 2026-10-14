# heldround-4926: a reply to a held post also answers the older held posts in that room (#4926 N7)

## Problem
Test-Mac log, 2026-10-13 19:31:31Z: the Meta seat (mark) held 9 posts of one round. It answered the round in one
reply to m1032. The idle flush dropped only m1032 as answered (staleHeld matches replyTo exactly) and told the other
8 again as new.

## Change
engine/messages.js staleHeld: when the member has replied in the room to ANOTHER member's post X, the held posts
among the ROOM_READ_ROWS - 1 room rows before X (and earlier than X) are answered too: dropped even if they ask, and
marked `answered` so a limit hold does not keep them back. Posts after X are untouched. ROOM_READ_ROWS (40) is the
default `kosmos room` row count, now read by server.js from messages.js rather than kept as a second literal.

## Why "taken with" needs no separate rule
A held id leaves the held list when a line tells it (take). Only restore puts it back, and restore runs only when
that line could not be typed, so the member never saw it. A post typed to the member carries the posts held for it
then, so they are taken with it and are not held afterwards.

## Weakest premise, and the residuals review 1 found
That the member saw the older posts when it saw X. The window is the most a DEFAULT read showing X can show. Not
covered, so an older unseen post can still be dropped:
- a read with a small -n, or a read made after many later rows (it showed X and fewer rows before it);
- two sends interleaving: Y's send starts first (earlier `at`), X reaches the member first and takes the held list,
  then Y is held. Milliseconds wide.
Rejected for these: recording what each read showed per member (dropShown already clears what a token read showed;
this rule exists for readers Kosmos cannot see), and dropping on any later post (an unrelated post would erase asks).
A reply to the member's own post covers nothing.

## Tests
engine/roomhold-stale-4926.test.js N7: 9 held (asks and plain), one reply to m1032 -> none of the 9 told, a newer
post told; controls for no reply, another room, another member, no member, a reply to the oldest post, a
reply to its own post, and the window edge (39 rows covered, 40 not).
