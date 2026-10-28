# kcircle-7417: TestFlight build 9 iPhone fixes (#7418, #7417, #7346 top, with #7346 bottom)

Josh, 2026-10-27 20:17 to 20:27 CDT, on TestFlight build 8. One branch so build 9 waits on one full suite, not three.

## Finished looks like
- A tapped notification for an agent (needs_you, replied, ready, or a room post the phone could not place in a room)
  opens that agent's chat in the native Agents tab (ChatView), cold launch included. A notice from a computer the
  app is not showing still opens that computer's board page, as before. Room notices still open the room first. (#7418)
- The gold K mark at the top left is its own whole circle, not clipped inside the computer switcher's glass pill. (#7417)
- Every screen's top bar is solid in the page's colour with a 10 pt fade below it, so no scrolled row shows behind
  the mark, the switcher or the buttons. (#7346, 20:21)
- The DM box sits on a solid strip down to the home indicator with an 18 pt fade (solidbox-7346, already reviewed:
  3 rounds, converged).

## Decisions
- #7418 native only when the notice's computer is the one the app shows (board.switcherShown): the chat reads
  through that computer, so opening another computer's agent natively would talk to the wrong one. Rejected:
  switching computers on a tap (it resets open chats through chatEpoch). Weakest premise: most people have one
  computer; a second computer's notice still lands on the board page.
- The agent opens from the list's own entry when the list has it, else from the notice (session and shown name);
  ChatView follows the list for status, so a not-yet-loaded list is fine.
- #7417 uses iOS 26's sharedBackgroundVisibility(.hidden) and ToolbarSpacer(.fixed); before iOS 26 there is no pill.
- #7346 top uses toolbarBackground(.visible) (iOS 16 API) and an overlay fade, on all nine screens with a nav bar.

## Verify
- iOS 16 simulator typecheck; all nine ios/LogicTests scripts (room suite: 14 new #7418 checks).
- Simulator shots of the Agents top bar, light and dark (~/work/design-shots/kosmos-7417-kcircle).
- Full suite (tools/run-tests.sh), then PR, merge, TestFlight build 9.
- Owed on a device: tapping a real notification, cold and warm.

## Review
(rounds recorded in commit messages "review N:")
