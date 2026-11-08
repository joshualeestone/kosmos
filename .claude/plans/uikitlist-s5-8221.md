# uikitlist-s5-8221: a phone can choose the UIKit chat list (kosmos#8221, slice 5)

Stacked on uikitlist-s4-8221 (the CI runner and the keystroke time), which is stacked on uikitlist-s3-8221 (PR #8257).
Rebase onto main as each merges.

## Finished looks like

On a TestFlight build, Settings has a switch that makes chats open on the UIKit list. It is off by default, so nothing
changes for a phone that never touches it. Each chat open records which list drew it in the diagnostic, so Josh's phone's
reports can be counted per list (the #7420 decision: "switch the chat to the UIKit list behind a release switch, in
slices, with his phone's counts comparing the two before the old one goes").

## Decided

- Call: a Settings switch, OFF by default. Rejected: on by default in TestFlight. The UIKit list does not yet load earlier
  messages (slice "earlier pages"), has no long press (copy, delete) and no side lock, so making it the default would take
  those away from the one person testing. Weakest premise: that Josh will find and turn on a switch; the card comment and
  his channel must tell him where it is, in one line.
- The choice is read once when a chat opens (an @State seeded from it), so flipping the switch never swaps the list under
  an open chat. The next open uses the new value.
- Storage: UserDefaults via @AppStorage, key "kosmos.chat.uikitlist" (the ProjectsView "kosmos.projects.sort" pattern).
  Debug keeps KOSMOS_SAMPLE_UIKITLIST=1 as an override so every UI check still picks its list by environment.
- Diagnostic: right after "chat shown", a fixed-word trace line, "list: uikit" or "list: lazy" (two literals in an
  if/else, so the room suite's trace allow-list needs no new value). Check run-room.sh still passes, and that a check
  pins the two literals.

## Steps

1. ChatView: `static let uikitList` becomes the stored choice (Debug: env override first). Seed `@State useUIKit` at init;
   line ~578 reads it. Update the comment at ~61 (it says "Off in a release build").
2. SettingsView: a "Chat" section with the switch. Copy (no em dashes): label "New chat list", footer "A test of a new way
   to draw your chats. Earlier messages and holding a message to copy or delete are not in it yet. Applies to the next
   chat you open." Check it at the largest text size.
3. ChatView trace "list: uikit" / "list: lazy" after "chat shown" (line ~380).
4. A LogicTests or source check pinning: default off, the key name, the trace literals.
5. A UI test: turn the switch on in Settings, open Dana's chat, and see the UIKit list drew it (find a way to tell: an
   accessibility identifier on ChatList's collection view, Debug or not).
6. /design-shots for the Settings section, light and dark, desktop-not-applicable (phone only).
7. All ios/LogicTests/run-*.sh, node --test server.ios-routes-6838.test.js, ui-sample.sh, ui-sample.sh --uikit.
8. Challenge loop; PR; merge on green; TestFlight build so his phone gets it (the TestFlight upload pattern from build
   57, see fleetreleases 11-07 21:17-21:42); tell Josh in one line where the switch is.

## Status

- [x] Steps 1-4 built 11-08 13:0x-13:3x CST. As built: the choice is `@State private var uikitList = ChatView.uikitListChosen()`
  (not `useUIKit`). UIKitListArm now sets KOSMOS_SAMPLE_UIKITLIST on BOTH arms ("1"/"0"), so a switch a run left on can never
  move a check onto the wrong list. ChatList's collection view carries the identifier "chat-list-uikit" (Debug or not).
  room suite: 4 new source checks (848/848); negative control, default flipped to true in a copy: FAIL 1 of 848 on the
  off-by-default check. All 13 LogicTests suites pass; ios.ui-sample-tally-7609 and server.ios-routes-6838 pass.
- [ ] Step 5: NewChatListSwitchUITests (off: lazy; on: the next chat is "chat-list-uikit"; off again: lazy), added to
  ui-sample.sh's lazy-arm classes. Local run pending.
- [ ] Steps 6-8.
