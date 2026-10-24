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
- Review 1: the relay's iPhone push carries no project, so the computer's notice answer names it and the extension
  writes it on (no relay change, and no project name added to what Apple carries). Rejected: adding it to apns.rs,
  a second repo and deploy for something the phone already asks the computer about.
- Review 2: with Projects native no tab hosts the board page until Tasks is earned, so the bar also earns Tasks from
  the native /api/status poll (add only; the engine's flag never goes back).
- Refusal lines and their folding follow the board (pjFoldRoomRows, pjRoomRow), not the slice 9 spec's sample line,
  which said "stopped it" for the folded band. The suite checks the board still draws those words.
- Weakest premise: the room's 5-second re-read of the newest page (50 rows) is enough to catch a post written late.
  A page that no longer overlaps what is shown replaces it (no hidden gap), but a late post dated before the newest 50
  is only seen once older pages are read again.

## Known gaps (stated)
- The pinned needs-you line has no Open when several agents wait (the spec sends it to Today).
- A refused press on a project page lands on native Projects (afterAnswer reads the address raw).
- Not drawn yet, though parsed: files attached to a room post (RoomRow.attachments) and the held strip with Reopen the
  room (RoomPage.held). Both are on the board's room page, one tap away (the info button).
- An addable refusal's Add button is not drawn (members stay on the board's page); the line itself is.
- A read that started before a reaction toggle can show the old pill until the next 5-second re-read.

## Steps
1. Models + suite. DONE. 2. Screens + shell. DONE. 3. Notification routing. DONE. 4. Review loop, validation, PR.
