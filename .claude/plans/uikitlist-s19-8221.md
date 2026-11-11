# uikitlist-s19-8221: follow a part of a tall newest reply above the screen

Card: joshualeestone/kosmos#8221, slice 19 (slice 12 follow-up 2). Built on slice 18 (#8360, merged), which edits the same line.

## Finished looks like

At the newest of a reply taller than the screen, a VoiceOver focus on a part of that reply above the top of the screen
(wholly, or crossing the top edge) puts that part on screen and the reader is no longer held at the newest. A focus on
the reply as a whole still keeps the reader at the newest. A fix-off control shows each new check can fail.

## Decided

Follow a part of the newest message (an element under three quarters of its row) that starts above the top of the
screen and does not reach below its bottom; keep the hold otherwise.
Rejected: dropping the newest hold (slice 18's control shows it moves the reader off the newest on a whole-message
focus, which VoiceOver also makes when it refocuses); keeping it as it was (the part read aloud is not the part shown, so
a reader using sight and speech together loses their place). Weakest premise: that a real reply exposes its parts as
separate accessibility elements. If SwiftUI gives one element per message, the rule never fires on a phone (harmless,
but it fixes nothing there). Would change my mind: a phone run with VoiceOver showing one element per reply, or
VoiceOver's own scroll to the part not being pinned back.

## Change

- ChatList.focusFollow: newestPart (an element under three quarters of its row's height that starts above the top of what shows and does
  not reach below its bottom) skips the newest branch and is followed as a message above is. DEBUG switch
  KOSMOS_SAMPLE_FOCUSNONEWESTPART for the controls, and KOSMOS_SAMPLE_FOCUSNOPARTSIZE (only the size test) for the
  whole-message control.
- Sample: KOSMOS_SAMPLE_TALLNEWEST (newest reply of 24 paragraphs); A11yFocus modes newestpart (the reply's first
  80 pt, wholly above) and newestclipped (80 pt crossing the top by 20 pt) and newestwhole (the whole reply, its row less 4 pt at
  each end), each an element in the newest cell's own
  view as SwiftUI makes one; the report gains "part shown", measured from the row at report time.
- A11yFocusUITests: four checks and their controls (14 -> 22); ui-sample.sh tally. The tall newest message is Dana's
  (a reply), not the person's.

## Review 1 (blind, opus): 0 BLOCKERs, 2 WARNINGs, fixed

- A paragraph crossing the top (the first one a reader stepping up reaches) was still held: the rule now covers it,
  with a check and control (newestclipped).
- The whole-row re-measure skip was untested and near-inert: removed; the sample part now sits in the cell's view.
- Not covered: the newest-part rule with VoiceOver's own scroll before or after the focus (slice 12's first/after
  orders); reasoned to work through scrolled() and rereadEnd, not measured.
- Known trade-off (raised again in challenge iteration 1, then narrowed): a part must be under three quarters of its
  row's height, so a whole reply's element a little shorter than its row (padding) is not taken for a part. A real part
  that large (a code block most of a reply) is held at the newest as before.

## Challenge loop

- Iteration 1 (sonnet): 2 WARNINGs. The part rule took any element shorter than its row: FIXED (under 3/4 of the
  row). The newest-part rule with VoiceOver's own scroll before or after: DEFERRED, since the rule only chooses the
  branch once per focus and then runs the same follow code slice 12's first/after checks cover for a message above.
- Iteration 2 (opus): 2 WARNINGs, 1 CONVENTION, 2 NITs. The size test had no check that could fail (the existing
  newest check is rejected by the bottom edge, not the size): FIXED with newestwhole and its control
  (KOSMOS_SAMPLE_FOCUSNOPARTSIZE). The rule's comment named the wrong guard: FIXED. This plan's Finished and Decided
  still said "wholly above": FIXED. The tall sample message was the person's, not a reply: FIXED (Dana's).
- Known trade-off (iteration 2 NIT): after a crossing part is followed (32 pt, inside the 40 pt end slack), stepping
  down to an on-screen part of the newest takes the newest branch, counts the reader at the newest again, and the next
  layout pins the list back 32 pt. The focused part stays visible; the list moves back and forth at the top edge.
- Iteration 3 (sonnet): 2 WARNINGs, 3 NITs. A part taller than the screen (a long code block) reaches past both
  edges and was held: FIXED (a part taller than what shows passes the bottom test), with newestlongpart and its control
  (14 -> 22). The fixed 0.75 split rests on what a real whole-message element measures: DEFERRED, it is this plan's
  weakest premise and only a phone with VoiceOver can settle it. Doc comment reflow and "the two edge tests": FIXED.
  Slice order of the ui-sample.sh comments: left (only the count is read).

## Results

- After review 1: A11yFocusUITests 18 of 18, 2 runs, identical readings. newestclipped moved 32 pt, part shown, off
  the newest; its control moved 0, part shown false, at the newest. newestpart unchanged (2090 pt).
- Before review 1: A11yFocusUITests, 2 runs on the iOS 26.5 simulator (iPhone 17e): 16 of 16 both times.
- newestpart with the rule: the newest row 11739 to 14447 (2708 pt, taller than the 647 pt list); the list moved 2090 pt
  up, shows 11747 to 12382, the part (11747 to 11827) shown, off the newest, pins 0, agrees. Same both runs.
- newestpart with KOSMOS_SAMPLE_FOCUSNONEWESTPART: moved 0, shows 13838 to 14473, part shown false, at the newest. So
  the check can fail.
- newest (the whole-message focus) still moved 0 at the newest; slice 18's controls unchanged (26 and 93).
