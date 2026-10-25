# roommention-7085: the @ member picker in the iPhone room's composer (a slice 9 gap, #6838)

**Done when:** on the iPhone, typing @ in a project room's box opens a list of the project's members, filtered as the
board's picker filters it, and a tap puts "@<key> " in place of what was typed; the rules are pure Board functions
tested against the board's own source; it is merged.

## Decisions
- The board's rules (web/index.html, the @ picker, #312): MENTION_TOKEN's boundary and key characters; members in the
  room's order, matched by the start of the key or of the shown name without case; a pick inserts the session key and
  a space; "Nobody on this project matches that." Each is pinned against web/index.html.
- The token is read at the END of the box, not at the cursor: SwiftUI's TextField does not expose its cursor on the
  iOS 16 target. On a phone the cursor is almost always at the end while typing; an @ typed in the middle of earlier
  words does not open the list. A UIKit text view would fix it and is out of proportion for this card.
- The list floats just above the box (an overlay), as the board's .mention sits over the thread, so the thread never
  moves while the person types. It shows only while the box has focus.
- Everyone who matches, as on the board, in a list that scrolls once it would cover more than half of the thread
  (review 1: a row cap let three wrapped rows at the largest text size run under the navigation bar). A light shadow,
  as the board's .mention has, so it reads as floating over the bubbles in dark mode.
- Rows are 44pt buttons with the name, plus "@key" when the key differs; VoiceOver reads the name and the @key, with
  a hint. The board's aria-activedescendant has no iOS equivalent, so VoiceOver hears the list open once ("3 agents
  match, above the box.") and goes back to the box after a pick.
- The open list covers the reply strip's Stop replying and the held notice's Reopen while a token is being typed; it
  closes the moment the token ends or the box loses focus. Accepted: the board's list also sits over what is above
  its box.
- Not here: the live blue highlight of a recognised @name (#2922 part 2), the + for a file.
- Weakest premise: the look, the scrolling list's height inside its overlay, and the cursor staying at the end after
  a pick are unverified by a screenshot or a device (the simulator run is not permitted here, #7055), and the
  end-of-box rule is a reading of how people type on a phone, not a measurement.

## Steps
1. Helpers, view, suite, build. DONE: room 173/173 (control: dropping the boundary check turns "admin@mara" red);
   Debug build SUCCEEDED, no slow expressions.
2. Review loop.
   - Round 1: 0 blockers, 3 warnings, 5 nits. Fixed: a test only the key can satisfy (W1, the key-match mutation
     now red); the list limited by height and scrolling, not by row count (W2); VoiceOver hears it open and returns
     to the box after a pick (W3); the key in the VoiceOver label, the board's shadow, a no-key test. Room 176/176;
     Debug and KOSMOS_STORE_SHOTS Release SUCCEEDED.
3. Validation, PR.
