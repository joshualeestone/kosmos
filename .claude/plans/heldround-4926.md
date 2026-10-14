# heldround-4926: a reply to a held post also answers the older held posts in that room (#4926 N7)

## Problem
Test-Mac log, 2026-10-13 19:31:31Z: the Meta seat (mark) held 9 posts of one round. It answered the round in one
reply to m1032. The idle flush dropped only m1032 as answered (staleHeld matches replyTo exactly) and told the other
8 again as new.

## Change
engine/messages.js staleHeld: when the member has replied in the room to post X, every held post in that room older
than X is answered too (dropped even if it asks, and marked `answered` so a limit hold does not keep it back).
Posts newer than X are untouched.

## Why "taken with" needs no separate rule
A held id leaves the held list when a line tells it (take). Only restore puts it back, and restore runs only when
that line could not be typed, so the member never saw it. A post typed to the member carries the posts held for it
then, so they are taken with it and are not held afterwards.

## Weakest premise
That the member saw the older posts when it saw X. If X reached it by a path that shows X alone and does not take
the held list, an older unseen ask is dropped. Every path found (room read, typed line with held posts) shows or
takes them.

## Tests
engine/roomhold-stale-4926.test.js N7: 9 held (asks and plain), one reply to m1032 -> none of the 9 told, a newer
post told; controls for no reply, another room, another member, no member, a reply to the oldest post.
