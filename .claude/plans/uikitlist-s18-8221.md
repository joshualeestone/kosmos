# uikitlist-s18-8221: controls for slice 12's "leave it alone" focus rules

Card: joshualeestone/kosmos#8221, slice 18. Off main.

## Scope

Slice 12's follow-up 6 (card, 2026-11-10 03:45): the on-screen focus check and the tall-newest focus check have no
fix-off control. Both assert that nothing moves, which a broken build could also satisfy if the scenario never reaches
the rule. This adds a control for each. Not in scope: follow-up 6's other points (the back check asserting only the end
state; the composer, a finger and slice 11's scroll as guards).

## Finished looks like

With focusFollow's two "leave it alone" rules taken away (a DEBUG switch), a focus on an on-screen message moves the
list, and a focus on the newest message moves the reader off the newest. Two new controls assert exactly that and
pass, so the existing checks are shown able to fail.

## Decided

A DEBUG switch, KOSMOS_SAMPLE_FOCUSNOGUARDS=1, that skips the newest branch and the on-screen guard in focusFollow,
rather than a separate code path. Rejected: deleting the rules in a test build, since a control must run the app's own
code with only the rule under test changed. Weakest premise: that removing the on-screen guard moves an on-screen
message at all. The scroll aligns its bottom to the screen's bottom, so a message already sitting there would not move.
Would change my mind: the control reading moved 0 on a run.

## Change

- ChatList: sampleFocusNoGuards (DEBUG, false in Release); focusFollow skips the newest branch and the on-screen guard
  when it is set.
- A11yFocusUITests: focus(mode:fixOff:noGuards:) and two controls (visible and newest modes).
- ui-sample.sh: A11yFocusUITests 12 -> 14.

## Results

- A11yFocusUITests, 2 runs on the iOS 26.5 simulator: 14 of 14 both times. The new controls read: visible with the
  rules off, moved 93 and off the newest; newest with the rules off, moved 26 and off the newest. The same modes with the
  rules on read moved 0 and at the newest, so each existing check is now shown able to fail.
- Limit, measured: the sample's newest message is 68 pt tall (row 11739 to 11807), not taller than the screen. So the
  newest rule is exercised on an ordinary newest message; "however tall it is" is still reasoned, not measured.
- Room suite 866 of 866.
