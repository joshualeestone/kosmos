# kosmos#7212 item 2: say when a said delivery stall ends

Card: joshualeestone/kosmos#7212, design comment 6582283787 (PigeonPete, 2026-11-02).

## Problem
`note()` in engine/deliverystreak.js deletes a streak on a `placed` verdict with no log and no push. A stall the board
log said (`delivery-stall:`) never says it ended, so the reader of the log cannot tell a stuck agent from one that
recovered an hour later.

## Change
- `note()`: on `placed`, if the streak was said (stallsToSay marks it `said`), record `{ since, count, endedAt, pushedAt }`
  in an `ended` map before deleting it.
- `tellStalls`: when a stall push (not a stuck step's) goes out, the streak keeps `pushedAt`; `untold` clears it on the
  streak and on its end record when the push is taken back.
- `endsToSay(said, { stuckOf })`: for each recorded end whose `since` matches the `said` entry stallsToSay keeps, return
  it once and spend the entry, unless `stuckOf(name)` (the card shows a stuck Windows step, which turn-stuck speaks for).
  Every end is dropped once read.
- `endedLine(e)` / `spanWords(ms)`: the `delivery-stall-ended:` log line ("Kosmos placed a message for X").
- `sweep()` drops ends for agents gone from the board; `reset()` creates none (no recovery).
- server.js minute sweep calls endsToSay after `byName` is built (stuckOf reads it) and BEFORE stallsToSay (which forgets
  a name whose streak is gone). A source-order test pins both.

## Decided, rejected
- Rejected: a phone all-clear in this change. coordinator/src/notify.rs refuses kinds outside
  posted/replied/ready/needs_you, and needs_you pages and is emailed when unacknowledged, so an all-clear sent as
  needs_you would be a false alarm. It needs a new kind in the relay and the phone app; `pushed` is its seam.
- Rejected: a card word for the recovery (the card clears by itself).

## Weakest premise
Streaks and `said` live in memory, so a stall said before a board restart and ending after it says nothing. Accepted:
same scope as the existing stall line, stated on the card.

## Tests
engine/stallended-7212.test.js, run with the related stall files (stallpush, heldwarn2, turn-7368, stallsignin,
server.stallob-7633). Each review fix was perturbed to show its test can fail; the counts are in the commit messages
and the PR, which are measured at the time, rather than here. Whole node suite after review converges.
