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
- Each chip of ours must hide at least `CHIP_HIDES_MIN` (half of `CHIP_MIN_CHARS`, squashed) of our line, so a
  person's own chip beside words of ours that hide nothing (our whole line plus a chip) is never ours.
- The looks are yielded waits (a generator), so the async delivery awaits them rather than blocking the board (#4468).
- The pin is taken once two reads a look apart agree (a fold can still be drawing). A failed read, or a form still
  changing after `FOLD_STABLE_LOOKS`, leaves the latest good read pinned, as main pinned one read: refusing there
  would only move the jam to the still-drawing case.
- After our Enter, a box holding any of our pinned chips is still ours (not sent). Otherwise a lone chip is someone
  else's as before, and text with someone's chip in it is judged by our end (`stillHoldsOurEnd`), as on main.

## Decided

  For a line long enough to fold, a box of only chips after the Enter is also said as not sent, pinned or not, since
  ours may be under them (a blind Enter, the read before it failed). The cost: if ours did go and a person then
  pasted only chips, that reads as not sent where main said sent for several chips. A shorter line cannot be under
  chips, so there it is judged by our end, as on main.
- No cap on how many chips a box may hold beyond the per-chip floor above. This widens a window main already had: a
  person who pastes a long block in the moment between our empty-box read and our Enter, on a line of ours long
  enough to leave room under the floor, is sent with ours. Before #6249 only one chip was accepted, so a second chip
  was always refused; the window is now wider for long lines. Accepted, because refusing every multi-chip box is the
  jam this card is about.
- `CHIP_HIDES_MIN` is an assumption, not a measurement: half of `CHIP_MIN_CHARS` after whitespace is squashed out. A
  line so full of whitespace that a fold hides fewer squashed characters than that would be refused, as all folds were
  before this card.
- Not done: a fold that pauses longer than a look and then continues can be pinned part-drawn. After the Enter the
  full box no longer equals the pin, so it reads as left there unsent and is not pressed again. That is safe, and
  pressing a box that grew past the pin would widen what counts as ours at the one moment a person's paste can land. A cap tied to length would rest on the read size, which was not pinned
  (a 1500-character single paste stayed text). The tie still needs an empty box just before our paste and a line of
  at least `CHIP_MIN_CHARS`.
- Text pieces must each be a run of our line, in order. Rejected: accepting any text next to a chip (a person typing
  after our paste would be sent with it).
- No minimum length for a text piece next to our chips. A person typing exactly an end of our line (a lone `.`, say)
  in the moment between our empty-box read and our Enter would be sent with it. That is the same window main already
  accepts for a lone chip (a person's paste in that second), and a floor would refuse genuine short remainders of a
  fold, which is the jam this card is about. Rejected: a 20-character floor like the plain-text rule's.
- A line of ours that itself contains `[Pasted text #N]` and also folds into a chip with that same number reads as
  words, not as a chip. Both at once is the one case that cannot be told apart; it falls to the word comparison.

## Weakest part

The batching under load is inferred, not reproduced: the shapes come from single large pastes, not from a loaded
board coalescing 256-byte chunks. If a loaded box produces a shape not covered here (the box read while Claude Code
is still drawing the fold, with a part-drawn chip, say), it is still refused, as today: the change only widens what is accepted, and never
in a way that sends a person's text.

## Not done

- The warning side (an agent left jammed shows as such) is #7212, separate.
- Measuring the batching on a loaded board.
