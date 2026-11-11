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

- ChatList.focusFollow: newestPart (element maxY above the top of what shows) skips the newest branch and is not
  re-measured as a whole row. DEBUG switch KOSMOS_SAMPLE_FOCUSNONEWESTPART for the control.
- Sample: KOSMOS_SAMPLE_TALLNEWEST (newest reply of 24 paragraphs); A11yFocus mode newestpart (an element for the
  reply's first 80 pt); the report gains "part shown".
- A11yFocusUITests: the check and its control (14 -> 16); ui-sample.sh tally.

## Results

(filled after the simulator runs)
