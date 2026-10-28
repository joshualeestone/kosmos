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

## Review rounds (ledger)

1. opus: 4 MAJOR, 7 MINOR, all fixed (commit 68312eb8dc lists them).
2. sonnet: 0 BLOCKER/MAJOR, 10 MINOR. Fixed: the settle after the archive's first page asks the archive's loader,
   not the live one; the new-row scroll stays out of the archive/live swap; Back scrolls to the boundary row only when
   it is still drawn, else to the newest post; a failed refresh is not asked again until the count changes again; each
   note's timer clears only its own note; the live rows are replaced when the archived count moves (no archived row
   left above the boundary, the board's pjRoomDropArchived); Back marks the room seen at once.
   Not fixed, decided: a refresh shows the archive's newest page and drops earlier pages read (the reader's place
   inside a deep archive is not kept; the board keeps it). The change check is the count only, not count plus marker.
   The 0.85 opacity's contrast is to be checked in the shots. A search over an empty live part with messages archived
   shows nothing (the board would search the archive too; the phone's search is of the live room).
3. opus: 1 MAJOR, 4 MINOR, all fixed. MAJOR: round 2's replace-on-move fired whenever the automatic rule moved the
   count (every post in a room past 1,000), wiping earlier live pages read. Now Board.archiveMoved acts only when the
   rows shown reach the start of the live part: k more archived drops the first k shown, fewer takes the page and its
   cursor; tested, and 2 of 2 mutations red. MINORs: the archive read no longer writes the live count; a failed
   refresh is asked again after 30 s; each note has its own view identity and timer; the new-row scroll compares the
   part it last saw instead of a flag set by another handler.
4. sonnet: 1 MAJOR, 2 MINOR, all fixed. MAJOR: an earlier live page read after the count moved left the stored count
   stale, and the next poll dropped live rows; loadOlder now stores its page's count. MINORs: a cut by count assumed
   the phone draws every row the server counts, so when the page reaches the live start the cut is its first row's
   time; nothing shown still live takes the page and its cursor. 4 of 4 archiveMoved mutations red.
5. opus: 1 MAJOR, 2 MINOR, all fixed. MAJOR (probed with the app's own code): the archive grew past the earlier live
   rows still unread, so the new live start fell inside the rows shown while a cursor was set, and archived rows
   stayed below the boundary. Rounds 3 to 5 each broke the count rule at a new edge, so it is rebuilt on one exact
   fact: a page with olderCount 0 holds the whole live part, so every row shown before its first row is archived
   (found by id; by time for a row the phone does not hold). Only when the live start is off the page does the count
   decide, net of the earlier rows still unread (older.count). An undo with earlier pages unread is left to the
   earlier-page read. MINORs: only the newest live read started counts a move (an older one landing late is not an
   undo); equal times at the boundary are covered by the id cut. 6 of 6 mutations red.
6. sonnet: 1 MAJOR, 2 MINOR, all fixed. MAJOR (probed): a move that stopped short of the rows shown, or an undo with
   earlier pages unread, kept older.count as it was, so the next move was measured wrong; every move now keeps it in
   step (two-read tests). MINORs: a read older than one already applied is dropped; an earlier-page read stores its
   count only if no newer live read landed while it was out. 7 of 7 mutations red.
7. opus: 1 MAJOR, 1 MINOR, fixed. MAJOR (probed against a model of the server): an earlier live page read at another
   archived count than the rows shown was merged, and its count stored or skipped by "did a read land meanwhile",
   which is not "was a read taken later"; archived rows stayed, or a live row was dropped. Now such a page is not
   merged: the newest read reconciles (archiveMoved on the cursor kept), then the earlier-page read is tried once
   more. MINOR: an overtaken poll at another count writes nothing. NOT unit-tested: these are in RoomStore, which needs
   a client; the room runner tests Board.archiveMoved only. Round 7's probe replayed the steps by hand.
8. sonnet: 0 BLOCKER/MAJOR, 2 MINOR, applied AFTER the last round (not reviewed): a retry used up sets olderFailed (the
   top shows Try again, not a spinner nothing loads); a cancelled task does not retry. Loop stopped at the 8-round cap.

## Not verified

- No screenshots yet: they go through the heavy queue, and the 0.7.73 cut holds the machine. A Debug sample
  (KOSMOS_SAMPLE_AGENTS=1 with KOSMOS_SAMPLE_ARCHIVE=1) gives the sample room an archive for them.
- Not run against a real board with an archive.
