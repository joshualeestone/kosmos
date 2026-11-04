# fileowner-7989: tell an agent when another agent writes a file it owns (kosmos#7989, slice 1)

Split from #7978 item 2 (an agent chased an unexplained "changed after render" that was another agent's edit).

## Decided (reversible; my call)
- **Owns** = the first agent seen about to change the file here: the agent engine/filewriters.js recorded when the file
  had no record yet (`first`, set once, never moved by a later write). A record from before this change has no owner and
  gets no notice, so the feature starts with no owners for existing files. Once a record is pruned (KEEP_MS, 30 days
  unwritten, or MAX_ENTRIES, 2000) its owner goes with it and the next writer becomes the owner (accepted).
- **The notice:** when another agent is about to change it, a `[kosmos]` note in that project's room for the agents
  (messages.roomNote, NOTE_AUDIENCE_AGENTS: `kosmos room` prints it, the person's room view leaves it out):
  `<writer> was about to change "<file>" (<owner> was the first agent seen changing it here). A notice, not a lock:
  <owner>, read it again before you build on what you last saw in it. For the next hour, Kosmos will not post a separate
  notice for each other file <writer> changes that you were the first seen changing.` At most once per writer and owner per
  project per hour (so a writer changing a whole folder of one owner's files leaves one note), and at most
  NOTICE_ROOM_MAX (6) per room per hour, after which ONE note says further notices are held back for the hour; kept
  under a key no file name can be. An owner no longer on the project gets no note and takes no slot (members are read
  only when a notice is due). Names not shaped like session names get no notice.
  The file's name is quoted, cut at 120 and has its square brackets made round, so it cannot spell a marker in a line
  in Kosmos's voice. An owner no longer on the project is not addressed. Nothing is refused.

## Rejected
Owner = last writer (it notices whoever happened to edit); agents declaring ownership (rarely done, so most files would
have no owner); typing the notice into the owner's session (it interrupts work for something that is not urgent).

## Weakest premise
That a room note reaches the owner soon enough: it is seen when the owner next reads the room, not pushed. The record is
made just before an edit (PreToolUse), so an edit that then fails still records and can notice (the copy says "was about
to change"); and only writes that reach that hook are recorded (#5812), not a write through a tool's own shell.

## Next slice (not here)
A CLI read of a file's last writer and owner; a notice that reaches the owner directly.

## Tests
engine/filewriters-owner-7989.test.js, each test in its own project and day: the owner is the first agent seen and stays;
another agent's write makes one agents-only note naming file, writer and owner; once an hour per writer and owner, never
for the owner's own writes, a new writer at once; the hour's edge; a 40-file burst makes one note; the room cap and its
held-back note, then notices again after the hour; a hostile and a long file name; a departed owner is not addressed and
takes no slot; a failing note never fails the write; an old record has no owner. Mutations proven red: the notice call,
the throttle, the bracket cleaning, the room cap, the hour edge, the membership check, the held-back note. The route's
audience filter is pinned in server.projects.test.js ("the brief-pending note reaches the agents").
