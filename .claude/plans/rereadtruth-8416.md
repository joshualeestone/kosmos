# rereadtruth-8416: a re-read notice names only real changes; a pasted request never splits a word

Card: kosmos#8416 (from the 11-11 daily feedback; given to Mona Lisa by Splinter 18:17).

## Finished looks like
(2) The instructions-changed notice (engine/instructionreread.js) never names a section that is not in the agent's file, nor one whose text is as the agent last read it, and sends nothing when no owed section is left. (1) An automatic message that chat pastes in pieces (the daily feedback request, 1257 bytes, five 256-byte pieces) never has a piece end mid-word. Each has a test that fails on main.

## Where each comes from (measured)
- (1) engine/feedbacknudge.js nudgeText, delivered by chat.deliverAutomatic, which pastes in PASTE_CHUNK_BYTES (256) pieces cut by chunkUtf8 at the byte budget. On main a piece of the real request ends "This session ma", mid-word. A composer that shows a later piece as separate pasted text then reads as two messages, the second starting mid-word.
- (2) engine/instructionreread.js. A section is owed whenever Kosmos rewrites its block (oweEach, oweChanged, oweNow), and a board-start sweep can rewrite a block to the same words. passOnce named every owed section without looking at the file.

## Shape (decided)
- (2) A section is named only when it is in the agent's file now and its fingerprint (printOf) differs from the mark Kosmos holds for what the agent was last told about it. The fingerprint is a hash of the section's own block, between its markers (projects.findBlock, so a heading inside a policy or an About-you answer never ends it), or, with no markers for it, of the text under its heading.
  - Marks (instruction-reread-marks.json, per session, per section) move only when the agent is told: every section at a session start (rememberRead), and only the named sections when a line lands, from the text read before it was typed.
  - So a block rewritten after a line landed and owed later still differs from its mark (review 2: the copy-of-the-file oracle let that go unnamed).
  - With no mark, a section in the file is named, as before. Markers that cannot be paired: named.
  - A section no longer in the file is not named: a removed block owes nothing, as oweEach already decides.
  - passOnce takes trueSections, markRead and readText injected, and ends a debt with nothing real as 'unchanged' (logged by server.js).
  - The #7149 copy still makes the changes file, and does not move when a section was owed again during the pass.
- (1) chunkUtf8 ends a piece just after a space when one is within its last 64 bytes (WORD_BACKOFF), or keeps the cut when the next byte is already a space. The pieces rejoin exactly as before. A space is one byte, so the character-boundary rule holds.
- Rejected for (1): shortening the request under one piece (256 bytes). It would drop the four questions and the privacy rules agents follow from it, and only this one message would be fixed, not every long automatic line.
- Rejected for (1): detecting a split and saying so. Kosmos cannot see how the composer grouped the pieces.
- Weakest premise for (1): word-boundary pieces fix the mid-word read, not the split itself; a busy composer can still show a later piece as pasted text. It now reads as whole words.
- Residual for (2), accepted: marks are a read-modify-write with no lock. Two processes writing at once can lose one, and a lost mark only names a section again (an older or missing mark differs from the file), never hides one.
- Residual for (2), accepted: a session start's marks are taken when its 'started' report reaches the board, a few seconds after the agent read its file. A block rewritten in that gap, and any later rewrite back to those same words, stays unnamed until it changes again. On main that gap's debt already ended as 'restarted'. Narrowing it needs the file as the agent read it, which nothing records.
- A section gone from the file loses its mark (trueSectionsFor), so a block removed and restored with the same words is named when it returns.
- Every section Kosmos can owe has its own marker pair (tested), so a renamed heading cannot make a Kosmos block read as missing.
- Marks move only on a PLACED line (review 3): an UNCONFIRMED one may never have been typed.
- A damaged block (one marker with no pair) and a heading written twice with no markers cannot be told, so they are named.
- Weakest premise for (2): a section's change is judged by its own text, so a change elsewhere in the file (outside any owed section) is not named. That is the point, and #7149's changes file still lists every change.
- Not built: the card's two smaller ideas (whose built mark, a machine-move checklist). Left on the card.

## Tests
- engine/chat.test.js: the real request's pieces each meet at a word boundary and rejoin exactly; a word longer than 64 bytes still cuts at the budget; multibyte text rejoins. Red on main ("a piece ends mid-word").
- engine/instructionreread.test.js: trueSections drops a missing or fenced heading, an unchanged section and a removed one, and keeps a changed one; a block rewritten after a line landed is still named, and only the named sections' marks move (control: a line that did not land moves none); a subsection's change counts; passOnce sends nothing when none is real, names only the real ones, and names all when the reader cannot tell (control). Red on main.
- Green: chat, instructionreread (three files), server.instructionreread-start-7149, engine.reachable, tree guards.

## Review ledger
- R1 opus: 2 W (a heading inside a policy or About-you block ended the section early; a copy moved past a section owed mid-pass), 1 C, NITs. Fixed: block markers; owed-again guard; unchanged logged.
- R4 sonnet: 3 W (the session-start residual understated; a removed-then-restored section unnamed; the one-writer claim), 1 C (review labels in comments), NITs. Fixed, residuals restated.
- R3 opus: 4 W (marks moved on an UNCONFIRMED line; session-start timing; a test that passed with the code wrong; a newline not a boundary), NITs. Fixed, the timing accepted and stated above.
- R2 sonnet: 2 W (the copy as oracle still let a block rewritten after a landed line go unnamed; a removed section dropped silently), NITs. Fixed: per-section marks that move only when told; the removal rule documented and tested.
