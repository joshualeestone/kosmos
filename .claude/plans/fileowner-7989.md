# fileowner-7989: tell an agent when another agent writes a file it owns (kosmos#7989, slice 1)

Split from #7978 item 2 (an agent chased an unexplained "changed after render" that was another agent's edit).

## Decided (reversible; my call)
- **Owns** = the first agent seen about to change the file here: the agent engine/filewriters.js recorded when the file
  had no record yet (`first`, set once, never moved by a later write). A record from before this change has no owner and
  gets no notice. A record dropped by KEEP_MS (30 days unwritten) or MAX_ENTRIES (2000) takes its owner with it, so the
  next writer becomes the owner (accepted: a file nobody touched in a month).
- **The notice:** when another agent is about to change it, a `[kosmos]` note in that project's room for the agents
  (messages.roomNote, NOTE_AUDIENCE_AGENTS: `kosmos room` prints it, the person's room view leaves it out):
  `<writer> was about to change "<file>" (<owner> was the first agent seen changing it here). A notice, not a lock:
  <owner>, read it again before you build on what you last saw in it.` At most once per writer and owner per project per
  hour (so a writer changing a whole folder of one owner's files leaves one note), kept under a key no file name can be.
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
engine/filewriters-owner-7989.test.js: the owner is the first writer and stays; another agent's write makes one
agents-only note naming file, writer and owner; once an hour per writer, never for the owner's own writes, a new writer
noticed at once; an old record has no owner and no note. Red with the notice call removed.
