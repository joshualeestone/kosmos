# heldwords-7208: plain words for a held message (kosmos#7208)

## Finished looks like
A person's message that Kosmos is holding reads as "nothing is wrong, here is why it waits", says the REAL reason
(out of usage or not running beats a half-typed message box), and is said once: on the message's own row, not
again under the composer.

## Built
- dmHeldWords: no "Held:". Out of usage (from the message or the agent's card): "X is out of usage until <time>.
  This delivers when X is back." Not running: "X is not running. This delivers when X is running again." Signed
  out: "X is signed out. This delivers once X is signed in again." Message box: "Waiting to deliver: X's message
  box has unsent text in it. Yours goes through as soon as that is cleared." Later messages: "Queued behind your
  earlier message to X."
- dmHeldAgent finds the agent's card (by the message's `to`, else the open chat) so the card's state can win.
- sendTalk: the line under the box no longer repeats the row.

## Decided (Josh's example copy adapted)
- Josh's example said "Dario is in the middle of typing ... as soon as he's done". Rejected: the text in the box
  may be Josh's own or left from before, so "typing" can be false, and the product never guesses an agent's
  pronoun. Said instead what is true: the box has unsent text.
- Weakest premise: the agent card's `state`/`limitUntil`/`running` is current enough at paint time (it is the
  same 5 s poll the card itself shows). If it lags, the row says the box reason for one poll.
- Would change my mind: Josh preferring his exact example words, which is a one-line swap.

## Evidence
- docs/browser-checks/render-dm-held-5805.js: 15 passed (each reason in its own words, nothing under the box);
  against origin/main's page, 9 red.
- Root unit set 3552/3552. #2518 surface gate exit 0.

## Review
