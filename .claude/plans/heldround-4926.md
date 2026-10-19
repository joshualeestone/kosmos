# heldround-4926: a reply to a held post also answers the older held posts in that room (#4926 N7)

## Problem
Test-Mac log, 2026-10-13 19:31:31Z: the Meta seat (mark) held 9 posts of one round. It answered the round in one
reply to m1032. The idle flush dropped only m1032 as answered (staleHeld matches replyTo exactly) and told the other
8 again as new.

## Change
engine/messages.js staleHeld: when the member has replied in the room to ANOTHER member's post X, the held posts
among the room rows before X that every default read showing X, made before that reply, showed are answered too:
ROOM_READ_ROWS - 1 rows, less one per row after X and before the member's first reply to it, in the read's order and
kinds (and earlier than X; nothing when the reply is not later than X). They are dropped even if they ask, and
marked `answered` so a limit hold does not keep them back. Posts after X are untouched. ROOM_READ_ROWS (40) is the
default `kosmos room` row count, now read by server.js from messages.js rather than kept as a second literal.

## Why "taken with" has no separate rule (reasoned, not guaranteed)
A held id leaves the held list when a line tells it (take). A post typed to the member carries the posts held for it
then, so they are taken with it. restore puts ids back when the line's delivery comes back COULD_NOT or empty, and
that includes a deliver that threw AFTER the paste (roomhold.flushOnIdle), so a line the member did see can be put
back. N7 drops more in that case, the safe direction for this card; a separate "taken with" rule was not built.

## How the 19:31 seat saw m1032 (open)
m1032 was held, so it was not typed to the seat. A read with its own token would have cleared all 9 shown ids through
#6116 (dropShown), so the seat most likely read the room WITHOUT its token. Reasoned from code, not measured:
engine/musefront.js never references KOSMOS_AGENT_TOKEN, and Muse has no report bridge (agy, codex, gemini and grok
each have one that reads it). If the seat saw m1032 some other way, the window is a guess for exactly the case that
motivated it. A second explanation fits too: a line that reached the seat was restored after its deliver threw
(above). The test-Mac board log (the seat's room reads and delivery lines around 19:31) would settle it.

## Weakest premise, and the residuals review 1 found
That the member saw the older posts when it saw X. The window is the LEAST any default read showing X, made before
the member's first reply to X, can have shown (the latest such read), not the 39 an immediate read shows. Not
covered, so an older unseen post can still be dropped:
- a read with a small -n. (Covered, by contrast: a default read made after later rows, because the rows after X
  and before the member's first reply are taken off the window.)
- the member learned X's id without reading the room (a direct message, the person naming it, a quote elsewhere)
  and replied to it having seen none of the older posts;
- a read the runner cut short: the server returned the rows, but the tool output limit dropped the oldest before
  the model saw them;
- a read the server itself could only partly render ("We could not read some of this room"), which showed fewer
  rows than the window assumes;
- two sends interleaving (the window itself follows the read's order by `at`, so a late-appended row is counted
  where the read shows it). A post restored after its typing failed and then held again is the same shape: Y's send starts first (earlier `at`), X reaches the member first and takes the held list,
  then Y is held. Milliseconds wide.
Rejected for these: recording what each read showed per member (dropShown already clears what a token read showed;
this rule exists for readers Kosmos cannot see), and dropping on any later post (an unrelated post would erase asks).
A reply to the member's own post covers nothing, and so does a reply to an outside (external) row (conservative).

Second premise (review 8): seeing an older ask is not answering it. An ask from another sender on another topic,
shown in the read, is dropped from the reminder though the member's reply was about X. Kept deliberately: it drops in the
same direction as #6116's dropShown (an ask the read showed leaves the held list), and the post stays in the room.
It is NOT equally grounded: dropShown acts on a read Kosmos observed and the exact ids it returned; N7 infers a read
from a reply's timestamp. The alternative, same-sender-only, would leave N7's case uncovered whenever the round had
more than one sender.

The rule covers asks too (@-named, cap-held and limit-held), deliberately: the 19:31 round may have been asks, and a
plain-only rule would then not fix N7. An older ask held for the member is unseen at the moment of its reply to X
only if X reached it without the held list, and the paths that deliver X (a typed arrival takes the held list; a
room read shows the window) do not, outside the two residuals above. The window counts only the row kinds the read
shows; outside rows are capped in the read, so the window is the smaller of the two, never the larger.

## Cost (raised by four reviews)
The window filters and sorts the room's rows only when a held post is in the room and the member has a readable
reply there. Measured on this computer: a 50,000-row log, one of five rooms, best of 20 runs, 0.73 ms for the filter
and sort. Not guarded further.

## Tests
engine/roomhold-stale-4926.test.js N7: 9 held (asks and plain), one reply to m1032 -> none of the 9 told, a newer
post told; controls for no reply, another room, another member, no member, a reply to the oldest post, a
reply to its own post, and the window edge (39 rows covered, 40 not).
