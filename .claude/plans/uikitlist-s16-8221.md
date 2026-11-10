# uikitlist-s16-8221: a delete under a reader up in earlier pages, measured

Card: joshualeestone/kosmos#8221, slice 16. Off main f31e6cac92.

## Scope

Slice 14 left this follow-up (card, 2026-11-10 10:49): only the moved-page path was measured. A delete, the moved gap
fill and Try again were reasoned to reach the same list code through restartEarlier. This slice measures the delete,
the one a person does with their own hands: deleting their own message while older pages are loaded and they are reading
up in them.

Not in scope: the moved gap fill and Try again. Both need a sample answer the board cannot give yet (a gap opening while
the chat is open, a "moved" answer repeated until Try again shows), and both still go through the same restartEarlier
that is measured here twice.

## Finished looks like

On the UIKit list, a reader one drag into the first earlier page, when their own newest message is deleted (through the
sheet's own deleteMine), lands at the top of what remains (Message 41), the page before is asked for again, and it lands
above them without moving them. A control with slice 14's fix off shows the reader elsewhere, so the check can see the
defect.

## Decided

A DEBUG hook, KOSMOS_SAMPLE_DELETE_ON_ASK=<k>, rather than driving the sheet from the test. Rejected: long-pressing the
newest message from the test, because a reader up in earlier pages cannot see the newest message; scrolling down to it
would take them out of the pages, which is the state under test. The hook calls the same deleteMine the sheet's Delete
calls, so everything from the delete onward is the app's own path.

It fires 2 s before the k-th page is due, so the drop lands before that page and the order is fixed. A delete that came
after the page would also drop both pages, but the check would then depend on timing.

Weakest premise: that a delete fired by a timer behaves the same as one fired from the sheet. The sheet adds a
confirmation and a dismissal, and the dismissal could move focus or scroll. Would change my mind: a report of a reader
moved somewhere else after deleting from the sheet with older pages open.

## Change

- ChatView (DEBUG): sampleEarlierAsks counts page asks in a launch; sampleDeleteOnAsk() deletes the person's newest
  message through deleteMine, 2 s before the k-th page is due. It writes one fixed trace line, "debug delete on ask".
- EarlierDroppedUITests: launch(control:drop:) with Drop .moved or .delete. The two slice 14 checks become shared helpers,
  and two new checks run them with .delete (fix and control). For the delete, "taken to the newest" is checked against
  Message 259, because the delete removes 260 and a check on 260 would pass whatever the list did.
- ui-sample.sh: EarlierDroppedUITests 2 -> 4 in the UIKit class list.

## Results

- UI, EarlierDroppedUITests x3 on the iOS 26.5 simulator: both new delete checks passed 3 of 3 (fix and control). The
  trace shows "debug delete on ask" and then "earlier pages dropped under the reader, put at the top of what remains".
  Slice 14's moved check failed once (run 3, line 74, "the first page never landed"). That is the setup flake slice 15
  instruments, in a check this slice does not change; its timing is on the card (comment 6773740316).
- node: 121 of 121 across the test files that read the touched files. Room suite 865 of 865.
