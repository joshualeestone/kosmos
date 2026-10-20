# pastechip-6717: our own long paste, folded into Claude Code's paste chip, is pressed and confirmed

Card: #6717 (cause confirmed 2026-10-20 22:31Z; Splinter: top card for 0.7.62). Liu Kang approved the work and set the
design rules (m6341). Reviewer: Raiden.

## Finished means

1. A long message that lands in an idle Claude Code agent's box as a paste chip is pressed and confirmed sent, and the
   agent takes the next message.
2. A person's paste chip (one line or several) is never pressed: not before a delivery, not in the gap before our
   Enter, not when it replaces ours.
3. A test with both, and a mutant each way.

## Measured (Claude Code 2.1.305, private tmux, 80x24, Enter never pressed)

- A bracketed paste of one 1,540-character line shows as `[Pasted text #1]`; a 12-line paste as `[Pasted text #2 +12
  lines]`; the next one-line paste `[Pasted text #3]`: N rises through the session and is not reused after clearing.
- Kosmos's own way (256-byte unbracketed chunks) of a 1,540-character line landed as full text on an idle box here; the
  install that reported the jam got chips. Which conditions fold Kosmos's chunks was not reproduced; the fix handles the
  chip however it arises.

## Decisions

1. **A chip counts as ours only when tied to our paste**, and only in its one-line form (a Kosmos message is always one
   line, cleanMessage). The ties:
   - right after our paste (the check before our Enter, and the confirm after it): the delivery read the box EMPTY just
     before pasting, holds the pane's delivery lock (no other delivery pastes), and the chip appears within the gap of
     a couple of seconds. Weakest point, named: a person pasting exactly one line in that same second looks the same.
   - a line left unsent: the exact chip seen then, its number included, is kept with the line (and on disk); a later
     delivery or retry presses it only if the box shows that same chip. A person's later paste gets a higher number.
   Rejected: "any chip is ours" (presses a person's paste); comparing the chip's number with the box before our paste
   (an empty box shows no number to compare).
2. **A chip not tied to us is someone else's text**: never pressed, and never read as "ours went" (the confirm used to
   read other text without our ending as sent; a chip hides its words).
3. **Item 2 of the card (board signal, re-queue) goes to a follow-up.** Today a refused direct message shows its
   could-not-deliver notice, a room post is held and retried when the box empties (#6256), `kosmos msg` prints "Not
   delivered" to its sender, and the tile says the box is stuck (#6249): nothing is dropped silently. Automatic re-send
   is the new part, and the cause the card confirmed (our own chip) no longer jams.

## Residuals

- A person who pastes a single long line into the box in the second between our paste and our Enter would have it read
  as ours (decision 1, weakest point).
- A person's own paste chip left in the box still holds the agent; #6728's sweep leaves a folded paste in place and
  logs it, by design (its words are not on screen to save).
