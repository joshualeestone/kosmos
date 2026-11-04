# boxgrow-7420: at the newest, a layout change settles back to the newest (kosmos#7420)

## Finished looks like
On Josh's phone, a chat at its newest message does not go blank when the message box grows or shrinks (typing, sending), when the
whole window replaces the small first page, or when the keyboard changes height. Measured by TestFlight builds on his phone (the
simulator does not reproduce the blank) and guarded by the room logic checks and a UI check on the varied long chat.

## What it does (ios/Kosmos/ChatView.swift)
- settleAtNewest(): the settled looks #7817 ran after a keyboard did-show now also run after a box-height change at the newest (it
  used to stop at "not followed") and after keepAtEnd: every thread read while the chat is kept at the newest (the whole
  window landing is one), so a reader at the newest gets the two looks after each arriving message too.
- At each look, at the newest with nobody scrolling: past the end -> put back (as before); within with NOTHING drawn -> rebuild the
  list (recoverEmpty, with its limits; build 34 showed the id jump lands in the inflated estimate's undrawn stretch); within, drawn, but
  the newest not showing (end marker gone, or, only after a did-show or a box change, ScrollBox.shortOfEnd() more than the
  list's bottom padding listPadV + 4 pt) -> scrolled to the end marker by id, as did-show does. A reader higher up (atBottom
  false) is never moved, nor one who nudged up a little after a thread read. The keepAtEnd ask is on the id-anchor path
  (iOS 17+) only; iOS 16 keeps its own two scrollTo calls. A box change counts for boxAskCarries (1.5 s), so a message
  arriving inside its looks does not drop the box-cover test. Neither arm acts inside a rebuild's grace. After its id
  scroll the settled look looks once more (keyboardSettle later) and only puts back a landing past the end: unlike the
  rejected follow (build 29, a scroll on every wrap with nothing checking where it landed), this scroll runs only when
  the newest is measured not showing, and its landing is checked.
- Limits: the looks also run while a chat opens (a pinned read before the end is seen); the rebuild waits for a first
  drawing there, the id scroll does not (it goes where the open is going anyway). Before iOS 18 the end marker leaving
  the screen clears atBottom, so the end-gone arm mostly reaches iOS 18+ (Josh's phone is iOS 26). No CI check exercises
  this behaviour: the UI check is Mac-only (260-message chat) and the simulator never shows the blank; the room source
  checks pin the wiring and guards.

## Evidence
Six build-33 captures and two build-34 captures from Josh (diagnostics in the session handoff dir; screenshots private, never on the
card). Every one: at newest, anchor end, no finger, a box/inset or window change, then 0 rows drawn or past the end; the one-try
rebuild drew rows each time.

## Rejected
- The #7828 follow (proxy.scrollTo on every wrap): it landed past every row (build 29).
- An id jump alone for the blank: build 34, 21:33, landed in the same undrawn stretch.
- Forcing measured heights (no LazyVStack API) or a UIKit table: too large for tonight; revisit if the rebuild does not hold.

## Weakest premise
That the rebuild is fast and invisible enough on a 200-message chat to run after a box change. If Josh sees a flash or a jump on
build 35, the trigger should narrow (only after a measured blank, not on every look).
