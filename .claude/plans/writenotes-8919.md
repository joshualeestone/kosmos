# writenotes-8919: say when `kosmos feedback write` replaces notes added earlier (kosmos#8919)

## Card
Found by Homer on Windows 0.8.16 while checking #8896: a later `kosmos feedback write` the same day drops the notes
`kosmos feedback note` added, and says nothing. Measured on the Mac engine too (a sandboxed run of origin/main
654ce5d624: the note is there before the second write, gone after, and write's result has no field for it). One
engine (engine/feedback.js) serves both CLIs.

## The call (reversible)
Keep replace as the contract (#5317: a re-run regenerates the writer's section): a rewritten report is written from the
agent's current view, and carrying old "Added later" lines onto new text can attach a correction to words that are no
longer there. But never silently. Rejected: keeping notes across a rewrite (stale corrections on new text); refusing
the write (blocks a legitimate regenerate). Weakest premise: that agents rewrite to replace, not to add; if they mostly
rewrite to add, keeping notes would be the better default, and this sentence at least shows them what went.

## Change
- engine/feedback.js: `write()` returns `notesReplaced`, the number of "Added later (YYYY-MM-DD HH:MM UTC):" lines in the
  section it replaced (`notesIn`, anchored to a whole line). `replacedNotesLine(n)` is the one sentence both CLIs add:
  "This replaced your earlier report for that day, and with it the note added to it later. If one still applies, add
  it again with kosmos feedback note." ('' for 0). note()'s comment updated.
- install/kosmos and tools/windows/kosmos-cli.js: after saving, the send sentence is followed by that sentence when
  notes went, including on the "could not check whether it was sent" path.
- Not changed: the board's own /api/feedback route (it writes the unnamed section and prints nothing to an agent).
  #8900's queued resend carries only the day and sends what the file then holds.

## Tests
- engine/feedback-writenotes-8919.test.js (4): two notes then a write counts 2 and they are gone, CONTROL the next
  write counts 0; another writer's note is kept and not counted; only a whole note-heading line counts; the sentence.
- cli.feedback-writenotes-8919.test.js (1) and tools.windows-kosmos-cli-feedback-writenotes-8919.test.js (1): write,
  note, write prints the sentence; CONTROL first and third writes do not.
- Mutations, each red: never counted (3), unanchored (1), Mac CLI silent (1), Windows CLI silent (1).
- The 11 existing test files that call feedback write: 166 pass.

## Review
(rounds recorded below)
