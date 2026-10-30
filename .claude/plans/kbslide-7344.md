# #7344: the iPhone chat keeps its newest message above the box when the keyboard comes up

**Branch:** `kbslide-7344` · **Card:** kosmos#7344 (Josh 10-27) · Handed over by Angel 10-30 02:04, who owns the DM build.

## Done when (the card's own words)

On a phone, with a DM open at its newest message, tapping the box keeps the newest message visible above it; a DM read
higher up stays where it was.

## The defect, measured 10-30 on main dd707952bc

A fresh iPhone 17e simulator (iOS 27.0, on-screen keyboard), sample agents, an XCUITest that taps:

- Dana's short chat, opened at its newest message by itself: after the tap the newest message sits behind the box.
- The long sample chat, scrolled down to "Message 260 of 260.": the box rises with the keyboard, the thread does not
  move, 258 to 260 are hidden.

The app's own trace (KOSMOS_SAMPLE_TRACE) shows the decision was right and the move did nothing:
`keyboard up 328 (atBottom true)`. So `keepNewestInView` was true and `keyboardDidShow` called `goNewest`.

## Why the move did nothing

On iOS 17 and later the chat is anchored by id (`.scrollPosition(id:anchor: .bottom)`, #7265). At the newest message the
anchor is already `"end"`. `goNewest` re-sets it through nil (`nil`, then `"end"` on the next turn), and SwiftUI sees the
same id it had: nothing scrolls while the keyboard shrinks the viewport, so the end falls below it.

## The change

`keyboardDidShow`, when `keepNewestInView`: under the id anchor, scroll to the end marker itself
(`proxy.scrollTo("end", anchor: .bottom)`, not animated) and set the anchor to `"end"`; on iOS 16, `goNewest` as before.
One handler, nothing else moves.

Not animated on purpose (review round 1): the side lock (#7574) writes the whole content offset at once only under the id
anchor, because there the move to the newest message is not animated; an animated scroll here could be stopped partway
by it.

- Rejected: a second `goNewest` after a delay. It re-sets the same id again and moves nothing for the same reason.
- Rejected: scrolling in `keyboardWillShow`. The viewport has not shrunk yet, so "the end" is still on screen.
- Weakest premise: `proxy.scrollTo` under an id-anchored scroll view. Measured working on iOS 27.0 in the simulator; not on
  a real phone, and not on iOS 17 or 18.

## #7420's side lock (#7574), as Angel asked

The side lock puts back a sideways shift by writing the whole content offset, y included, at once under the id anchor.
That is safe only for a scroll that is not animated, so this one is not (see above). The checks below run with the side
lock in place (it is on main).

## The regression guard

`ios/KosmosUITests/KeyboardSlideUITests.swift`, three checks with taps, and `ios/tools/ui-keyboard.sh` to run them on a
fresh simulator (no CI job runs the UI tests target, so the runner is what makes the guard runnable):

1. short chat at its newest message: the newest stays above the box and keyboard;
2. long chat scrolled to its newest message: the same;
3. long chat read higher up (KOSMOS_SAMPLE_SCROLLUP=40): the top message stays where it was.

Each of 1 and 2 carries a control that the newest message was above the box before the keyboard.

**Both arms, measured 10-30 on a fresh iPhone 17e simulator (iOS 27.0), every run of the current checks:**

| | short chat (1) | long chat (2) | either failed |
|---|---|---|---|
| with the change | passed 6 of 6 | passed 4 of 4 | 0 of 4 runs |
| without it | **failed 5 of 6** | **failed 2 of 4** | **4 of 4 runs** |

Check 3 passed in every run on both arms (the change does not pull a reader down). Its own control, after review
round 1: with `keepNewestInView` forced true (a local edit, never committed), check 3 **fails** (the row read higher up
leaves the screen) while 1 and 2 pass, so it can see a pull-down. Round-1 arms with the reworked checks: with the change
3 of 3 pass; without it 1 and 2 fail; forced, 3 fails. **The defect is intermittent, and so is
each check alone**, which fits Josh seeing it sometimes rather than always. Neither check is a certain guard alone. The
two together caught it every time without the change, and never fired with it. Weakest premise: four runs are a small
sample for "every time"; ui-keyboard.sh is the way to add more.
