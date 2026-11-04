# fileowner-7989: tell an agent when another agent writes a file it owns (kosmos#7989, slice 1)

Split from #7978 item 2 (an agent chased an unexplained "changed after render" that was another agent's edit).

## Decided (reversible; my call)
- **Owns** = the agent engine/filewriters.js recorded writing the file when it had no record yet (`first`, set once, never
  moved by a later write). A record from before this change has no owner and gets no notice (no guessed owner).
- **The notice:** when an agent other than the owner writes it, a `[kosmos]` note in that project's room for the agents
  (messages.roomNote, NOTE_AUDIENCE_AGENTS: `kosmos room` prints it, the person's room view leaves it out):
  "<writer> is changing <file>, a file <owner> first wrote here. A notice, not a lock: <owner>, read it again before you
  build on what you last saw in it." At most once per file and writer per NOTICE_EVERY_MS (an hour), kept as `noticed`
  in the file's record. Nothing is refused.

## Rejected
Owner = last writer (it notices whoever happened to edit); agents declaring ownership (rarely done, so most files would
have no owner); typing the notice into the owner's session (it interrupts work for something that is not urgent).

## Weakest premise
That a room note reaches the owner soon enough: it is seen when the owner next reads the room, not pushed. Also, only
writes that reach the keep-before-write hook are recorded (#5812): a write through a tool's own shell is not.

## Next slice (not here)
A CLI read of a file's last writer and owner; a notice that reaches the owner directly.

## Tests
engine/filewriters-owner-7989.test.js: the owner is the first writer and stays; another agent's write makes one
agents-only note naming file, writer and owner; once an hour per writer, never for the owner's own writes, a new writer
noticed at once; an old record has no owner and no note. Red with the notice call removed.
