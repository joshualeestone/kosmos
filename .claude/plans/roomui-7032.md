# #7032 part 2: the native Projects tab and a project's room (slice 9 of #6838)

**Done when:** on the iPhone, Projects is a native tab showing the board's project tree (its word, unread bubble, faces,
four orders, Archived folded) and a project opens its room natively (senders' runs, replies, reactions, the silence line,
Kosmos lines in the board's words, the board's composer posting with the board's Not posted / Not confirmed lines), read a
page at a time from part 1's route; a room notification opens that room (or the board's page for another computer) and
shows the post's words; the shell sends the board's project pages under Today.

## Decisions
- The room model sits beside ChatRow (BoardRoom.swift), not in it: a 1:1 thread has one sender, a room needs one per row,
  and runs keyed by sender so two agents in a row never merge.
- Parsers are tested against JSON captured from the real routes (room-page.json, projects.json), not hand-written.
- Projects native follows the Settings and Today precedent: the board's project pages and an unearned Tasks section show
  under Today; the hidden page never moves the native tab.
- A room notification opens natively only for the computer the app keeps; otherwise the board's room page under Today.
- Weakest premise: the room's 5-second re-read of the newest page (50 rows) is enough to catch a post written late; a
  room busier than 50 rows during one post's delivery would miss it until the page is re-read.

## Known gaps (stated)
- The pinned needs-you line has no Open when several agents wait (the spec sends it to Today).
- A refused press on a project page lands on native Projects (afterAnswer reads the address raw).

## Steps
1. Models + suite. DONE. 2. Screens + shell. DONE. 3. Notification routing. DONE. 4. Review loop, validation, PR.
