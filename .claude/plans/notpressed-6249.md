# #6249: a line not pressed beside other text is remembered, not lost

Card: joshualeestone/kosmos#6249. Cause measured in issuecomment 6931686222 (Agent1s board log, 2026-11-14 18:04Z:
box 448 characters, ours 292, read as other text over five more looks).

## What finished looks like

A line Kosmos typed into an agent's input box that also holds other text is no longer forgotten. It is kept with its
message number and retried, and it is pressed (by a retry or by the next delivery) only when the box shows exactly all
of it. The other text is never sent with it. Tests show this, and fail on the old code.

## The cause

engine/chat.js, finishSubmitSteps: when the box read as other text before our Enter, it returned UNCONFIRMED
`not-pressed` and kept nothing (no rememberUnsent, no scheduleUnsentRetries). settle() did the same for the after-Enter
`other` outcome (forgetUnsent). So the line was never sent unless a person pressed Enter on the mix, and the #6717
sweep later moves the whole box into a draft for the person, so the agent never hears it.

## The change

- `rememberMixed(target, wire, card)`: remembers the line with a new number, `seen: ''`, `mixed: true`, and starts the
  #6436 retries. Called from the not-pressed branch (its verdict now carries `unsentSeq`, which messages.js already
  records for any unsubmitted verdict) and from settle() for the after-Enter `other` outcome.
- `rememberedShows`: a `mixed` line counts only when the box shows all of it. A plain unsent line may also count by a
  long visible end in a scrolled box; a mixed one may not, because the rows above that end are where the other text was.
- `mixed` is kept on disk and loaded back, so a board restart keeps the rule.
- The two sentences a sender reads now say what happens next: pressed on its own only if the other text goes and the
  box shows just this line.

## Decided

- **Round 2 of the first #6249 review pinned "a line that met other text is not remembered".** Reversed here. That rule
  came before rounds 6 and 8 made every press need the box to hold exactly our line. With that in place, pressing a box
  that holds exactly our whole line sends only our words, whatever was there before. Leaving the old rule meant the
  agent never got the message.
- **Rejected: re-typing our line after the #6717 sweep drafts the box.** It would add an unattended paste path. Not
  needed for the stall (the sweep already ends it), and the sender was already told the line is sitting there unsent.
- **Rejected: pressing anyway.** It would send the other text as part of our message (case 1 on the card).

## Weakest premise

A person who deletes their own words and leaves exactly our line may have been about to edit ours too. A retry 30 s
later sends it. The same is already true of any plain unsent line today, so this adds no new kind of risk. It does add
one more case where it can happen.

## What would change my mind

If the "other" text turns out to be our own line drawn differently (the #8333 hypothesis), remembering does not help:
the box never shows our line whole, so it is never pressed, and the sweep drafts it. That would need a different fix
in composerHolds, not here.

## Tests

- engine/chat.notpressed-6249.test.js (new, 7 tests): the number on the verdict; the next delivery presses only after
  the other text goes; after-Enter `other` too; retries press only an exact box; an emptied box forgets it; a scrolled
  end of a mixed line is never pressed (CONTROL: a plain one is); the mark survives a restart.
- engine/chat.composer-6249.test.js: the round 2 test now pins the part that still holds (never pressed while the
  other text is there).
- Control 1: the new file against main's chat.js: 6 of 7 fail (the scroll test passes there because nothing was kept).
- Control 2: with only the `if (kept.mixed) return false;` line removed, the scroll and restart tests fail.
- Focused run: the chat composer/unsent/stuckinput/pastechip/chipshapes/8021 files: 135 pass. Guards
  (fixture-discipline, sandbox-data-4796, no-brand-refs, no-name-refs, engine.reachable) and engine/messages*: 387 pass.

## Review

Challenge loop, capped at 8 rounds unless a BLOCKER is open.
