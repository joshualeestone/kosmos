# incomplete-9016: the iPhone says when a file arrived incomplete (kosmos#9016, slice 2 of the phone half)

Finished means: a file the Mac marks `incomplete: true` (a zip-based file whose ending is missing, engine/attachments.js
incompleteZip, Angel's board half #9042) shows "incomplete upload, please send again" on its card in the iPhone app,
in the warning colour, as the board shows it beside the file; files without the field look as before.

## Built
- ios/Kosmos/BoardLogic.swift: Attachment gains `var incomplete: Bool = false` (default, so the 20 existing
  constructions are unchanged); parseAttachments reads it (only a real `true`); attachmentMeta adds the board's words
  after the kind and size ("PDF · 2.4 MB · incomplete upload, please send again"), which is also the card's VoiceOver
  label.
- ios/Kosmos/ChatFiles.swift: the line is drawn in Palette.dangerWord when incomplete (the board's att-bad).
- LogicTests: read, words and order, absent field, a non-boolean value.

## Checked
Every iOS logic suite passes (run.sh 2754/2754 after round 1); the ios.* node tests pass. The view file is compiled by CI's iPhone
build, not by the logic suites.

## Weakest premise
The words are the board's, copied: if the board's wording changes, this does not follow it. A shared source would be
better but the phone has no copy of the board's strings today.

## Round 1 (opus, blind): nothing blocking; fixed
- The words were cut off on a one-line card at default text size: an incomplete file's line has no line limit.
- VoiceOver in a project room read only file names: the room's files label says the words for an incomplete file.
- A JSON 1 counted as true: now Board.isTrue, as the board's === true (tested).
- Known gap, recorded for a follow-up: the composer's waiting file (Board.Attached, from uploadResult) does not show
  the warning before sending, though the upload answer carries it; the board marks the waiting chip. It shows on the
  card once sent.
- Kept: the whole line in Palette.dangerWord (the board's project file list colours its whole line; its message card
  colours only the words in amber). The phone has no amber warning colour today.

## Round 2 (sonnet, blind, whole branch): nothing above NIT. Converged.
- Compile read: types, optional lineLimit and the label closure all check; FileCard has only a minimum height, so a
  wrapped line grows the card and its whole-card button (44 pt target kept).
- NIT taken: the room label puts the words in parentheses after the file ("b.xlsx (incomplete upload, please send
  again)") so the next file name cannot read as part of it. NIT taken: the stale count above.
