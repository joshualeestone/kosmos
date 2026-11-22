# cutnames-8912: a cut changes file names the sections it left out (kosmos#8912, slice 1)

## Card
kosmos#8912: six agent feedback reports on instruction-change notices. Ask 2: "When the diff is incomplete, name the
sections that changed beyond it, so the re-read can be targeted." The call for all four asks is on the card
(comment 7087433333): slice 1 is ask 2, slice 2 is ask 1 (an id per notice, an append-only changes file), asks 3
and 4 rejected with reasons.

## Before
`engine/instructionreread.js` `changedLines` caps the changes file at 160 lines / 32 KB. When it cuts, it ends with
"[More changed than fits here: read the sections the notice names.]" The notice names whole blocks ("the working
rules" is about 40 sections), so a cut sends the agent back through all of them.

## Change
- `changedLines` records where each shown run starts and the first run not shown whole (`cutAt`). On a cut, the note
  names every section from that run on: `[More changed than fits here. Not shown: the changes under "B"; "C". Read
  those sections in full.]` One name reads "that section"; the lines above the first heading are named as such; a
  section with two runs is named once.
- The names make the note longer than the room kept for the plain note, so the whole is measured against both caps.
  When it does not fit, the last shown run gives way (its section joins the list), down to one run; only then does
  the list shorten, to at most `CUT_NAMES_MAX` (12) names and "and N more sections", which also tells the reader to
  read every section the notice names.
- The changes file header: "If it ends with a note that more changed, it is not complete: that note names the
  sections to read in full."

## Not changed
- The notice line (`lineFor`), the debt file, delivery, marks, `seen`: slice 2.
- The moved-line notes (kosmos#8743) still come before the cut note.
- A diff where nothing fits still returns null (the notice names no file), as before.

## Tests
- New `engine/instructionreread-cutnames-8912.test.js` (7 tests): names the partial run and every one after and
  none shown whole; CONTROL a diff that fits has no note; "that section" and one name for two runs; the lines before
  the first heading; long names make runs give way, every section exactly once, inside both caps; over twelve: twelve
  names and "and 9 more sections"; the header sentence.
- Updated: `engine/instructionreread.test.js` (the exact cut line, now naming "Next") and
  `engine/instructionreread-changes-7149.test.js` (the header regex).
- Mutations, each red: partial run not named (3 red), no giving way (1), no name cap (1), no dedupe (1), no
  singular (1). The "no giving way" mutation stayed green on the first version of the long-names test, so that test
  was rebuilt to need it.

## Review
(rounds recorded below)
