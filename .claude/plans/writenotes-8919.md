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
- engine/feedback.js: `write()` returns `notesReplaced`, the number of notes in the section it replaced whose whole
  block (its "Added later (YYYY-MM-DD HH:MM UTC):" line, anchored, and the text up to the next one) the new text does
  not carry (`notesLost`), so a rewrite made by editing what `show` printed keeps them and is not told they went. `replacedNotesLine(n)` is the one sentence both CLIs add:
  "This replaced your earlier report for that day, and with it the note added to it later. If it still applies, add
  it again with kosmos feedback note." ("one" for several; '' for 0). note()'s comment updated.
- install/kosmos and tools/windows/kosmos-cli.js: after saving, the send sentence is followed by that sentence when
  notes went. In install/kosmos node prints it on its own GONE line after SAVED and the shell adds it to whichever
  message it prints, so its own fallback ("could not check whether it was sent") carries it too.
- Not changed: the board's own /api/feedback route (it writes the unnamed section and prints nothing to an agent).
  #8900's queued resend carries only the day and sends what the file then holds.

## Tests
- engine/feedback-writenotes-8919.test.js (5 after round 1): two notes then a write counts 2 and they are gone, CONTROL the next
  write counts 0; another writer's note is kept and not counted; only a whole note-heading line counts; the sentence.
- cli.feedback-writenotes-8919.test.js (1) and tools.windows-kosmos-cli-feedback-writenotes-8919.test.js (1): write,
  note, write prints the sentence; CONTROL first and third writes do not.
- Mutations, each red: never counted (3), unanchored (1), Mac CLI silent (1), Windows CLI silent (1).
- The 11 existing test files that call feedback write: 166 pass.

## Review
- Round 1 (opus): WARNING, a rewrite that keeps a note (an edit of what show printed) was told the note went, and an
  agent doing as told would add it twice. Fixed: notesLost counts only blocks the new text does not hold; test with an
  edited-note CONTROL. WARNING, install/kosmos's own fallback message dropped the sentence. Fixed with the GONE line;
  test forces the fallback with an engine whose feedbacksend cannot make a sentence. CONVENTION, a literal em dash in
  my test's regex: now an escape. NIT taken: "If it still applies" for one note. NIT not taken: a heading-shaped line
  typed into a note's own text counts (rare, over-counts in the safe direction).
- Mutations after round 1, each red: never counted (5), kept notes counted (1), unanchored (1), Mac CLI silent (2),
  Windows CLI silent (1).
- Round 2 (sonnet): no BLOCKER or WARNING; NITs (a very short kept note could be matched by an identical heading
  elsewhere, errs toward under-reporting; notesIn only used by tests).
- Full suite at 06cf9ff390: 1 red, engine.reachable (#265): `notesIn` was exported and tested but reachable from no
  caller. Fixed: neither counter is exported (only `replacedNotesLine` is, which both CLIs call); the anchoring test now
  goes through write() itself. Its first form left the anchor mutation green (the line ended in "): x", so `$` refused
  it whatever `^` did); rebuilt so the line ends at the heading-shaped text, and the mutation is red.
- Mutations after that: never counted (6), kept notes counted (1), unanchored (1), Mac CLI silent (2), Windows CLI
  silent (1).
