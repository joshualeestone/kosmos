# rereadtruth-8416: a re-read notice names only real changes; a pasted request never splits a word

Card: kosmos#8416 (from the 11-11 daily feedback; given to Mona Lisa by Splinter 18:17).

## Finished looks like
(2) The instructions-changed notice (engine/instructionreread.js) never names a section that is not in the agent's file, nor one whose text is as the agent last read it, and sends nothing when no owed section is left. (1) An automatic message that chat pastes in pieces (the daily feedback request, 1257 bytes, five 256-byte pieces) never has a piece end mid-word. Each has a test that fails on main.

## Where each comes from (measured)
- (1) engine/feedbacknudge.js nudgeText, delivered by chat.deliverAutomatic, which pastes in PASTE_CHUNK_BYTES (256) pieces cut by chunkUtf8 at the byte budget. On main a piece of the real request ends "This session ma", mid-word. A composer that shows a later piece as separate pasted text then reads as two messages, the second starting mid-word.
- (2) engine/instructionreread.js. A section is owed whenever Kosmos rewrites its block (oweEach, oweChanged, oweNow), and a board-start sweep can rewrite a block to the same words. passOnce named every owed section without looking at the file.

## Shape (decided)
- (2) trueSections(sections, now, before): a section is named only when one of its headings is in the file now (outside fenced code) and, when Kosmos holds the copy the agent last read (#7149), its text (from the heading to the next heading of its level or higher) differs from that copy. With no copy, a section in the file is named, as before. "The working rules" uses the defaults.sections() headings. passOnce takes it as an injected trueSections, filters the debt, and ends a debt with nothing real as 'unchanged' (no line). The server passes ir.trueSectionsFor. A reader that cannot tell (null) names everything, as before.
- (1) chunkUtf8 ends a piece just after a space when one is within its last 64 bytes (WORD_BACKOFF). The pieces rejoin exactly as before. A space is one byte, so the character-boundary rule holds.
- Rejected for (1): shortening the request under one piece (256 bytes). It would drop the four questions and the privacy rules agents follow from it, and only this one message would be fixed, not every long automatic line.
- Rejected for (1): detecting a split and saying so. Kosmos cannot see how the composer grouped the pieces.
- Weakest premise for (1): word-boundary pieces fix the mid-word read, not the split itself; a busy composer can still show a later piece as pasted text. It now reads as whole words.
- Weakest premise for (2): a section's change is judged by its own text, so a change elsewhere in the file (outside any owed section) is not named. That is the point, and #7149's changes file still lists every change.
- Not built: the card's two smaller ideas (whose built mark, a machine-move checklist). Left on the card.

## Tests
- engine/chat.test.js: the real request's pieces each end on a space and rejoin exactly; a spaceless text still cuts at the budget (control). Red on main ("a piece ends mid-word").
- engine/instructionreread.test.js: trueSections drops a missing or fenced heading and an unchanged section, and keeps a changed one; a subsection's change counts; passOnce sends nothing when none is real, names only the real ones, and names all when the reader cannot tell (control). Red on main.
- Green: chat, instructionreread (three files), server.instructionreread-start-7149, engine.reachable, tree guards.
