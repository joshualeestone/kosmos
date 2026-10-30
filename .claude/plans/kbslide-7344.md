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
One handler. Two small changes in it besides the scroll, both after review: it now acts only for the chat on screen
(`visible`, as its neighbouring handlers do), so a chat kept alive under another tab no longer scrolls when the keyboard
comes up for a different screen; and it writes one trace line. Neither has a check of its own.

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
2. long chat (KOSMOS_SAMPLE_LONG=1) at its newest message after the reader's own scroll comes to rest there: the same;
3. long chat read higher up (KOSMOS_SAMPLE_SCROLLUP=40 moves the reader up the thread): the highest row on screen stays where it was.

Each of 1 and 2 carries a control that the newest message was above the box before the keyboard.

**Both arms, measured 10-30 on a fresh iPhone 17e simulator (iOS 27.0).** Short and long were not always run
together: the short check ran alone in two early runs, so the columns count runs of each check, and "full runs" counts
only the runs that had both.

| | short chat (1) | long chat (2) | full runs with either failing |
|---|---|---|---|
| with the change | passed 6 of 6 runs | passed 4 of 4 | 0 of 4 |
| without it | **failed 5 of 6 runs** | **failed 2 of 4** | **4 of 4** |

Check 3 passed in every run on both arms (the change does not pull a reader down). Its own control, after review
round 1: with `keepNewestInView` forced true (a local edit, never committed), check 3 **fails** (the row read higher up
leaves the screen) while 1 and 2 pass, so it can see a pull-down. Round-1 arms with the reworked checks: with the change
3 of 3 pass; without it 1 and 2 fail; forced, 3 fails. Round 4 (check 2 briefly on varied heights, check 3 waiting for the
scroll up rather than sleeping, the shared Simulator preference untouched): with the change 3 of 3 pass; without it 1
fails and 2 passed (the defect is intermittent, as below); forced, 3 fails. **The defect is intermittent, and so is
each check alone**, which fits Josh seeing it sometimes rather than always. Neither check is a certain guard alone. The
two together caught it every time without the change, and never fired with it. Weakest premise: four runs are a small
sample for "every time"; ui-keyboard.sh is the way to add more.

## After review round 5

- **Check 2 is back on the uniform long sample.** For one round it ran on `KOSMOS_SAMPLE_LONG=varied`, and its only
  no-fix run there passed, so that version was never seen to catch the defect. The uniform version is the one with
  no-fix failures on record. **Measured after round 5, the checks as committed:** with the change 3 of 3 pass; without
  it, check 2 alone **failed 3 of 3 runs**. **Not covered:** a tall newest message from the agent. The varied sample's newest row is a
  one-line message from the person, so no check puts a tall message at the end.
- **The user-facing cost of not animating:** under the id anchor the move runs once the keyboard is up, so the newest
  message is covered while the keyboard rises, then jumps into place. That is the price of not fighting the side lock
  (above). Do not "fix" it by adding an animation here.

## After review round 6

- Check 3 finds "the highest row on screen" below the navigation bar's own bottom edge, not a fixed 120 points, and
  treats the newest message as gone when it no longer exists (a lazy list drops rows far off screen) as well as when it
  is not hittable. **Measured 10-30 04:2x CDT on a fresh simulator, the checks as committed:** with the change 3 of 3
  pass; with `keepNewestInView` forced true (local edit, reverted), check 3 **fails** ("Message 213 of 260", read
  higher up, left the screen). One run per arm.

## After review rounds 7 and 8 (the cap)

- **Fixed (round 8):** check 3 could tap before the scroll-up hook clears `atBottom` (3.6 s after the chat opens), which
  would read the reader as at the newest and fail the check for no real reason. It now waits until 4.2 s after the
  sample rows first appear. Measured 10-30 04:3x CDT, one run per arm: with the change 3 of 3 pass; with
  `keepNewestInView` forced true, check 3 fails ("Message 213 of 260"). This change came after the eighth review and
  was not itself reviewed; the two runs are its evidence.
- **Deferred, for a follow-up, per the 8-round cap (no BLOCKER open):**
  - iOS 17 and 18, and a real phone: not measured. This Mac has only the iOS 27 runtime, and an older runtime is a
    multi-GB download on a disk below its floor (kosmos#7606). The card closes on a phone, not on the simulator.
  - The covered-while-rising, then jump, under the id anchor (above). Judged on a phone.
  - The `visible` guard on keyboardDidShow has no check of its own; `keyboardWillShow` still sets `keepNewestInView`
    for a chat that is not on screen, which only that guarded handler reads.
  - No CI job runs the UI tests target; `ios/tools/ui-keyboard.sh` is how they are run.
  - A nil step before `positionId = "end"`: not taken. A later re-anchor would set the same "end", which is the target.
