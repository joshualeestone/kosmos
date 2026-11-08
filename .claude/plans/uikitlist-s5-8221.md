# uikitlist-s5-8221: a phone can choose the UIKit chat list (kosmos#8221, slice 5)

Stacked on uikitlist-s4-8221 (the CI runner and the keystroke time), which is stacked on uikitlist-s3-8221 (PR #8257).
Rebase onto main as each merges.

## Finished looks like

On a TestFlight build, Settings has a switch that makes chats open on the UIKit list. It is off by default, so nothing
changes for a phone that never touches it. Each chat open records which list drew it in the diagnostic, so Josh's phone's
reports can be counted per list (the #7420 decision: "switch the chat to the UIKit list behind a release switch, in
slices, with his phone's counts comparing the two before the old one goes").

## Decided

- Review 3 (11-08 13:59): the counts a phone sends (per chat open, and the sideways-shift report) carry no list, and a chat
  on the UIKit list builds no diagnostic (its blank checks are not wired yet), so per-list COUNTS are not possible after this
  slice. Call: this slice ships the switch and the record line only; slice 6 makes UIKit opens countable (the open count
  carries the list, engine/chatopens.js keeps it per build and list, the UIKit list gets the blank check). Rejected: doing
  it here (an engine and board change on a converging review). Weakest premise: that the switch is worth having before slice
  6; it is for how the chat feels, not for counts, and Josh is not pointed at it for counts until slice 6 is in.
- Shown in every build, not only TestFlight: the app is TestFlight only today (a beta with no outside users), and the switch
  is off by default. Would change: an App Store release, before which the section is gated or removed.

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
2. SettingsView: a "Chat" section with the switch. Copy (no em dashes): label "New chat list", footer (as built) "A test of a new way
   to draw your chats. Earlier messages, and holding a message to copy or delete it, are not in it yet. Applies to the next
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
- [x] Step 5: NewChatListSwitchUITests (off: lazy; on: the next chat is "chat-list-uikit"; off again: lazy), added to
  ui-sample.sh's lazy-arm classes. Run 1 (13:10) failed in the check itself: after the swipes up to the switch, iOS 26
  collapsed the tab bar to "Settings" alone (value Collapsed, read from the failure's UI hierarchy), so no Agents tab. Fixed
  by swiping down until Agents is back. Run 2 (13:21-13:23, iPhone 16e simulator): PASS. The arms control each other: the
  on arm finds "chat-list-uikit", so the off arms' absence is not a missing identifier.
- [x] Step 6: design shots, native (mobile-shots.js shoots the web board only, so taken from the iPhone 16e simulator with
  simctl, Debug sample board, KOSMOS_SAMPLE_TAB=settings KOSMOS_SAMPLE_SCROLL=chat; =chat is new, Debug only, since at the
  largest text the account scroll leaves the Chat section below the screen). ~/work/design-shots/kosmos-8221-s5/: light and
  dark, off and on, and the largest text (label wraps to two lines, the switch keeps its place, the footer reads in full).
  All five looked at 13:41.
- [ ] Steps 7-8.
