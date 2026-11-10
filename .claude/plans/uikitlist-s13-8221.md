# uikitlist-s13-8221: VoiceOver's Message actions on the UIKit chat list, measured

Card: joshualeestone/kosmos#8221, slice 13. Off main 72c373917f.

## Scope

The card's open item "VoiceOver copy/delete on UIKit cells". A VoiceOver reader reaches Copy and Delete through the
bubble's "Message actions" action (ComposerExtras.swift, MessageActionsAccessibility), which calls the sheet's opener from
SwiftUI's environment. A UIKit list cell hosts its bubble in a UIHostingConfiguration, which does not inherit the chat's
environment; ChatList.configure (slice 8) carries openMessageActions and shownMessageActions in. Reasoned that it works;
nothing measured it on this list.

Not in scope: the lazy list (its bubbles are not in hosted cells); the card's other open items.

## Finished looks like

On the UIKit list, running a message's "Message actions" the way VoiceOver does opens the sheet: Copy text and Delete
message on the person's own message; Copy text and Reply, no Delete, on an agent's. A control with the opener left out of
the cell shows the check can see the action open nothing. If the measurement fails, the fix lands in this slice.

## Change

- ChatList.Coordinator.sampleA11yActions (DEBUG, KOSMOS_SAMPLE_A11YACTIONS=<delay>, _TEXT=<label substring>): walks the
  accessibility elements of the visible cells (views that are elements, containers' accessibilityElements, subviews),
  picks the first whose label contains the text and has custom actions, runs its "Message actions" handler (actionHandler,
  or target/selector), and reports element count, found, the action names, and whether it ran (sampleA11y, "actions").
  VoiceOver does not run on a simulator and XCUITest cannot perform a custom action, so the app runs it.
- KOSMOS_SAMPLE_NOCELLACTIONS=1 (DEBUG): configure leaves openMessageActions out of the cell. The control arm.
- ios/KosmosUITests/A11yActionsUITests.swift: 3 checks (control, own message, agent's message), UIKit arm only.
- ios/tools/ui-sample.sh: A11yActionsUITests:3 in the UIKit class list.

## Weakest premise

Running the action's handler from the app is how VoiceOver runs it, but not VoiceOver itself: a defect in how VoiceOver
finds the element in a hosted cell (the element tree it walks, not the one this walk does) would not show. Slice 12's
focus checks found SwiftUI's elements by the same walk, which is some evidence the trees agree.
