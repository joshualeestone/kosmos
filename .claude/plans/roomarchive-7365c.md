# roomarchive-7365c: the room archive on the iPhone (kosmos#7365 slice 3c)

## Finished looks like

- The phone's room reads only the live part, as agents' `kosmos room` does: every page read sends `archive=0`
  (the board's pjWinRead does the same since slice 3b). Before this, the phone's paged read sent no `archive`, so it
  scrolled back into archived messages.
- At the start of the live part, with messages archived, the board's boundary row: "Older messages are archived."
  and View archive. Not while searching, and not while there is an earlier live page to read.
- View archive opens the archive in the same room screen: a header (Archive, how many messages, Back to the room),
  the archive's newest page first and earlier pages on reaching the top, with the same cursors, and "This is the start
  of the room." at its start. Opening and coming back are announced in the board's words.
- Every word is the board's (web/index.html, slice 3b), and the room runner checks each against the page.

## Decided

- **Reading only.** The phone does not set the archive ("Archive older messages") or put it back ("Put them back").
  Both stay on the computer for now: the card says the phone reads the live room, and the archive is the computer's
  to manage. Reversible: either can be added later as its own slice.
- **An archived post is read-only on the phone:** Copy stays; Reply and reactions go. The archive view has no
  composer (the board hides it there too), so a Reply would lead nowhere. Drawn a shade quieter (0.85 opacity), as
  the board's archive bubbles are quieter.
- **The archive is a reading posture,** like search: leaving the room closes it, and coming back shows the live room.
- While the archive shows, the live reads go on (the working line, the unread counts) and the live rows stay as they
  were. A read for an archive closed or opened again meanwhile is dropped (each open is numbered).
- A failed first archive read leaves the room as it was and says "We could not open the archive just now." once.
- Weakest premise: the boundary row uses the live part's olderCursor being nil as "the start of the live part". The
  route gives a cursor exactly when olderCount > 0, so they agree, but a computer that sends olderCount > 0 with no
  cursor would show the row with earlier live messages unread.

## Not verified

- No screenshots yet: they go through the heavy queue, and the 0.7.73 cut holds the machine. A Debug sample
  (KOSMOS_SAMPLE_AGENTS=1 with KOSMOS_SAMPLE_ARCHIVE=1) gives the sample room an archive for them.
- Not run against a real board with an archive.
