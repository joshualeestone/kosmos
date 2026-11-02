# chipshapes-6249: our own paste, folded into several chips (or chips and text), is pressed

Addresses #6249 (follow-up to #6717's #6780).

## Finished looks like

1. A message of ours that Claude Code shows as several chips (`[Pasted text #2][Pasted text #3]`), or as chips with
   pieces of our own line between them, is pressed and confirmed sent, as a single chip is today.
2. Left unsent in that shape, it is kept by its exact folded form (numbers included, same pane process) and pressed by
   the next delivery and by a retry.
3. Every #6717 control still holds: a person's chip in the box before us, a person's paste in the gap, a chip with
   other words, a several-lines chip, another number, a restarted Claude Code, a chip first seen after our Enter, an
   unread box before the paste, and a short line of ours.

## Why

Measured 2026-11-01 on Claude Code 2.1.312 (card comment on #6249): one 3000-character paste showed as three chips, so
Claude Code does not fold one message into one chip. Kosmos pastes in 256-byte chunks, which on an idle box never
folded at any length; how a loaded box batches them was not measured. `composerHolds` accepts only one one-line chip
alone in the box, so any other folded shape reads as someone else's, the pre-Enter check refuses to press, and the
agent jams. That is the 0.7.70 report on #6249, a version that already had #6780.

## Change (engine/chat.js only, plus tests)

- `isChipBox` means "the box is one chip, or shows a chip that is not words of our own line", not only "the box is one
  chip". A message that merely mentions `[Pasted text #2]` is still compared word for word. Everything that already defers to an
  exact kept chip for a chip box (`rememberedShows`, the after-Enter watch) then covers every folded shape.
- `composerHolds`, for a chip box: ours when `chip === true` (box read empty before our paste, under the delivery
  lock, and our line long enough to fold) and the box is only one-line chips with, between them, pieces of our own line
  in order; or when it is exactly the pinned/kept folded form. Otherwise 'other', as today. A several-lines chip is
  still never ours (our line is one line).
- The pre-Enter pin (`ourChip`) and the kept `chip` record the whole squashed folded form, not only a single chip.

## Decided

- No cap on how many chips a box may hold. A cap tied to length would rest on the read size, which was not pinned
  (a 1500-character single paste stayed text). The tie still needs an empty box just before our paste and a line of
  at least `CHIP_MIN_CHARS`.
- Text pieces must each be a run of our line, in order. Rejected: accepting any text next to a chip (a person typing
  after our paste would be sent with it).

## Weakest part

The batching under load is inferred, not reproduced: the shapes come from single large pastes, not from a loaded
board coalescing 256-byte chunks. If a loaded box produces a shape not covered here (the box read while Claude Code
is still drawing the fold, with a part-drawn chip, say), it is still refused, as today: the change only widens what is accepted, and never
in a way that sends a person's text.

## Not done

- The warning side (an agent left jammed shows as such) is #7212, separate.
- Measuring the batching on a loaded board.
