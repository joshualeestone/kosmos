# uikitlist-s17-8221: after a delete, the next earlier page is asked from the window as it is

Card: joshualeestone/kosmos#8221, slice 17. Stacked on uikitlist-s16-8221 (PR #8358, held by the 0.8.02 merge hold);
rebased onto main once that merges.

## Scope

The follow-up filed in slice 16's review (card comment 6775777443). On the Mac a delete shifts the latest window by one:
one message fewer, so the newest earlier message moves into the window and olderCount drops by one. The chat restarts
its earlier pages on a delete (deleteMine), and with the reader at the top (slice 14 puts them there) it asked for the
next page at once, from the olderCount it read before the delete. That page brings the message that has just moved into
the window, and the phone has no check for a thread that shrank below its earlier rows (the board does, kosmos#5841), so
the message stays drawn twice: at the end of the page and at the start of the window. The same stale count follows a
"moved" answer.

Checked against the board before building. It keeps its earlier pages on a delete and asks the next one from its own
EARLIER.before, and it reads the thread again (paintTalk) before it paints; when no pages are open the first is asked
from that fresh read. The phone instead restarts its pages on a delete (deleteMine, so a row the pages hold is not drawn
twice) and then asks from the count it read before. The server's older route answers a page asked from the old count with
positions up to it, the one that moved into the window included, and the range check (olderCount + rows == before) holds
for it, on the board (earlierFetch) and the phone (readOlder) alike.

On a moved answer the board does not wait: earlierMore resets and repaints from its last body and the next scroll asks
from that body's count. The phone now waits there for a read, deliberately stricter than the board (review 3).

Not in scope: a shrink check like the board's (#5841) on the phone. It would catch the duplicate after the fact by
dropping the pages again (the reader jumps); this slice stops it being asked for.

Applies on both chat lists and in Release (the stale count is the chat's, not a list's): after every delete there is
one more thread read, and after a moved answer the next page waits up to one 5 s read. Only the UIKit list is
measured (the checks are UIKit-only). A Try again tapped before that read lands does nothing until it does (the line is
blank for up to one read); rare, since the next read usually lands first. Only a read that shows a window (a whole thread
or an unchanged one) lifts the wait; a failed read does not (review 1).
Every delete sets the wait, also with no pages open, since the first page would be asked from the same count (review 2).
Measured for a delete only: for a moved answer the checks show the next page still comes (EarlierDroppedUITests' moved
arm, within one read), not that no row is drawn twice; the control switch covers both (review 2).

## Finished looks like

On the new chat list (where it is measured), a reader up in earlier pages who deletes their own message (with the window
shifting as the Mac's does) sees the message that moved into the window drawn once. A fix-off control shows it drawn
twice. After a "moved" answer the next page waits for the next read. Slice 14's and 16's checks still pass.

## Decided

After a delete or a moved answer drops the pages, no page is asked for until a read started after the drop has been
shown (earlierWaitsForRead holds the read count at the drop; a window read with a higher number lifts it). A delete
starts that read at once, as the board's paintTalk does, so the wait is one read's round trip; after a moved answer it
is the next 5 s read. Rejected: (1) adjusting olderCount by one on a delete, because the Mac's window rules (what counts
as a message, files set aside) are the Mac's, and guessing them is the failure this replaces; (2) a shrink check that
drops the pages again, because the reader would jump a second time (out of scope above). Weakest premise: that one read
after the drop always reflects it. A read already in flight is dropped by deleteMine (readShown = readsStarted), and the
gate needs a read started after. Would change my mind: a trace with a page asked between the drop and a read started
after it.

## Change

- ChatView: earlierWaitsForRead, set on every delete (with an immediate read) and on a moved answer (page
  or gap fill); loadEarlier waits while it is set and no read started after it has been shown, and traces "earlier out:
  waits for a read". KOSMOS_SAMPLE_NOREADFIRST=1 is the control. Cleared on a chat reset.
- BoardClient (DEBUG): KOSMOS_SAMPLE_DELETE_SHIFTS=1 makes Dana's long chat shift its window on a delete as the Mac's does.
- EarlierDeleteShiftUITests (new, 2): the fix and its control, counting "Checking the venue list, item 40." (position 39,
  the message that moves) once the page asked for after the delete has landed.
- EarlierDroppedUITests: at the top of what remains, the page before is now asked for within one read (up to 10 s).
- ui-sample.sh: the new class in the UIKit list and the earlier-pages trace block.

## Results

(after the simulator runs)
