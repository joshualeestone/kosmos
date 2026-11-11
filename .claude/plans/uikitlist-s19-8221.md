# uikitlist-s19-8221: follow a part of a tall newest reply above the screen

Card: joshualeestone/kosmos#8221, slice 19 (slice 12 follow-up 2). Stacked on slice 18 (#8360), which edits the same line.

## Finished looks like

At the newest of a reply taller than the screen, a VoiceOver focus on a part of that reply wholly above the screen puts
that part on screen and the reader is no longer held at the newest. A focus on the reply as a whole (the existing
tall-newest check) still keeps the reader at the newest. A fix-off control shows the new check can fail.

## Decided

Follow a part of the newest message when the focused element lies wholly above the screen; keep the hold otherwise.
Rejected: dropping the newest hold (slice 18's control shows it moves the reader off the newest on a whole-message
focus, which VoiceOver also makes when it refocuses); keeping it as it was (the part read aloud is not the part shown, so
a reader using sight and speech together loses their place). Weakest premise: that a real reply exposes its parts as
separate accessibility elements. If SwiftUI gives one element per message, the rule never fires on a phone (harmless,
but it fixes nothing there). Would change my mind: a phone run with VoiceOver showing one element per reply, or
VoiceOver's own scroll to the part not being pinned back.

## Change

- ChatList.focusFollow: newestPart (an element shorter than its row that starts above the top of what shows and does
  not reach below its bottom) skips the newest branch and is followed as a message above is. DEBUG switch
  KOSMOS_SAMPLE_FOCUSNONEWESTPART for the control.
- Sample: KOSMOS_SAMPLE_TALLNEWEST (newest reply of 24 paragraphs); A11yFocus modes newestpart (the reply's first
  80 pt, wholly above) and newestclipped (80 pt crossing the top by 20 pt), each an element in the newest cell's own
  view as SwiftUI makes one; the report gains "part shown", measured from the row at report time.
- A11yFocusUITests: two checks and their controls (14 -> 18); ui-sample.sh tally.

## Review 1 (blind, opus): 0 BLOCKERs, 2 WARNINGs, fixed

- A paragraph crossing the top (the first one a reader stepping up reaches) was still held: the rule now covers it,
  with a check and control (newestclipped).
- The whole-row re-measure skip was untested and near-inert: removed; the sample part now sits in the cell's view.
- Not covered: the newest-part rule with VoiceOver's own scroll before or after the focus (slice 12's first/after
  orders); reasoned to work through scrolled() and rereadEnd, not measured.
- Known trade-off: if a real reply's element is a little shorter than its row (padding), a focus on the whole tall
  reply now shows its top and leaves the newest, so a reply still growing is not followed while it is focused.

## Results

- After review 1: A11yFocusUITests 18 of 18, 2 runs, identical readings. newestclipped moved 32 pt, part shown, off
  the newest; its control moved 0, part shown false, at the newest. newestpart unchanged (2090 pt).
- Before review 1: A11yFocusUITests, 2 runs on the iOS 26.5 simulator (iPhone 17e): 16 of 16 both times.
- newestpart with the rule: the newest row 11739 to 14447 (2708 pt, taller than the 647 pt list); the list moved 2090 pt
  up, shows 11747 to 12382, the part (11747 to 11827) shown, off the newest, pins 0, agrees. Same both runs.
- newestpart with KOSMOS_SAMPLE_FOCUSNONEWESTPART: moved 0, shows 13838 to 14473, part shown false, at the newest. So
  the check can fail.
- newest (the whole-message focus) still moved 0 at the newest; slice 18's controls unchanged (26 and 93).
