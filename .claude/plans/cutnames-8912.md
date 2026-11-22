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
  While it does not fit, in order: the last shown run gives way (the first time that is the run it cut inside, already
  named), down to one run; that run's lines give way from its end, down to one line; the list shortens to "and N more
  sections" (at most `CUT_NAMES_MAX`, 12, names to start with), down to one name; and last, the plain note, whose room
  is kept, so the file always fits.
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
- Round 1 (opus): BLOCKER, a single shown run could not give way, so the longer note pushed a byte-bound file over
  32 KB (measured 56 widths over, worst by 65 bytes) and the list shortened to "1 more section", naming nothing.
  Fixed: the run's lines give way, then the plain note. New test sweeps widths 150 to 400 (0 over), and a plain-note
  fallback test. WARNING, the room comment was stale: rewritten. WARNING, no single-run test: added. NITs taken: the
  header-sentence test only grepped source (removed; 7149's test reads the written file); "the lines before the first
  heading" reworded to "the part before the first heading", and "the changes under" to "changes in"; the give-way order
  is now listed in the comment. NIT not taken: a heading containing `"; "` makes the list ambiguous; headings are
  Kosmos's own or the person's, and the list is read by an agent, not parsed.
- Mutations after round 1, each red: partial run not named (5), no runs give way (1), no lines give way (1), no plain
  fallback (1), no name cap (1), no dedupe (1), no singular (2).
