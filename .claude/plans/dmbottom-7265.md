# dmbottom-7265: a long Direct Message opens on its newest message

Card: kosmos#7265 (Josh 10-26: opening a long DM on the iPhone landed mid-thread).

## Finished looks like

On the iPhone, opening a long Direct Message shows its newest message, every time, on every supported iOS version. A
short chat opens exactly as it does today. A reader who scrolls up is never pulled back down, and a page of older
messages landing above keeps the reader where they were.

## Cause

The chat is a ScrollView over a LazyVStack and jumps to its "end" marker on open. Lazy rows below the screen are only
estimated until drawn, so in a chat of long messages the jump stopped short (measured: inside message 255 of 260 in
almost every open).

## Steps

1. ChatView: draw the newest rows as one eager VStack inside the LazyVStack (at least 40, the cut moving in steps of
   20 so a row crosses to the lazy part once per 20 new messages). Their real heights are known when the jump runs.
2. The eager rows count as on screen together, so when an older page lands and the reader is at the newest message
   (the end marker has shown, it is showing, the top is not), keep them there without animation instead of anchoring
   to the eager stack's first row.
3. Debug only: KOSMOS_SAMPLE_LONG=varied (a 260-message chat of varied lengths) and KOSMOS_SAMPLE_NOFIX (every row
   lazy, the control arm in the same build).
4. Verify: LogicTests and the repo tests that read the app's Swift; the simulator, 10 opens each arm, newest message
   read from the screen at 4 s and 10 s, a short chat compared with the control, scroll to the top holds; blind review.

## Decided

- Rejected after measuring (rounds 6 to 13 on the card): bottom scroll anchors, repeated jumps, and iOS 18's
  ScrollPosition jumps to the bottom edge. The jumps never converged (they land on the same estimate), and the
  first-layout anchor that did land also drew a blank chat in 1 to 2 opens in 5.
- Stated limit: a reader stopped part way inside the newest rows as an older page lands may still move.
- Weakest premise: that the simulator's sample chat reproduces what Josh saw on his phone. The symptom matches (a long
  chat opening mid-thread); the mechanism is the one measured here.
