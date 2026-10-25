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
- At most 5 rows (3 at accessibility text sizes) so it stays clear of the thread with the keyboard up; when some are
  not shown, the last line says "Type more of the name to see the others." This line is the phone's own: the board's
  list has room for everyone.
- Rows are 44pt buttons with the name, plus "@key" when the key differs; VoiceOver reads the name with a hint naming
  the @key. The board's aria-activedescendant is a keyboard pattern with no iOS equivalent.
- Not here: the live blue highlight of a recognised @name (#2922 part 2), the + for a file.
- Weakest premise: the look is unverified by a screenshot (the simulator run is not permitted here, #7055), and the
  end-of-box rule is a reading of how people type on a phone, not a measurement.

## Steps
1. Helpers, view, suite, build. DONE: room 173/173 (control: dropping the boundary check turns "admin@mara" red);
   Debug build SUCCEEDED, no slow expressions.
2. Review loop (after #7080 is in its PR; both touch RoomView.swift).
3. Validation, PR.
