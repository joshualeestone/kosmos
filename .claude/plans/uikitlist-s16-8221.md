# uikitlist-s16-8221: a delete under a reader up in earlier pages, measured; and a landing page is not asked for again

Card: joshualeestone/kosmos#8221, slice 16. Off main a5f06d88c7 (rebased onto slice 15).

## Scope

Slice 14 left this follow-up (card, 2026-11-10 10:49): only the moved-page path was measured. A delete, the moved gap
fill and Try again were reasoned to reach the same list code through restartEarlier. This slice measures the delete,
the one a person does with their own hands: deleting their own message while older pages are loaded and they are reading
up in them.

Not in scope: the moved gap fill and Try again. Both need a sample answer the board cannot give yet (a gap opening while
the chat is open, a "moved" answer repeated until Try again shows), and both still go through the same restartEarlier
that is measured here twice.

Added on the way (11-10, card comments 6775301855 and the one after): slice 15's request lines, plus a caller name on each
request, caught the setup flake. A page lands, and a read resuming before the list's "top gone" report requests the next page
with no swipe. That is a real bug (one page more than the reader asked for), so its fix is in this slice too.

## Finished looks like

On the UIKit list, a reader one drag into the first earlier page, when their own newest message is deleted (through the
sheet's own deleteMine), lands at the top of what remains (Message 41), the page before is asked for again, and it lands
above them without moving them. A control with slice 14's fix off shows the reader elsewhere, so the check can see the
defect.

And: on the UIKit list, a page landing is never followed by a request for the next one before the list has said where the
top is. A check makes the race certain (a read's request at the moment of landing) and passes; its fix-off control shows the
request going out.

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

For the double ask: when a page's rows land, the chat marks the top as not showing at once (UIKit list, pages with rows
only), and the list re-reports its top after every change in its rows, changed or not. Rejected: reporting synchronously
from the list (the report is deferred so state is not changed during a view update), and a time guard after landing (it
only narrows the gap). Weakest premise: that every landing with rows changes the list's ids, so the re-report always comes;
a reader left marked "not at the top" while they are would need a swipe to load more. Would change my mind: a report of
earlier messages not loading at the top until a swipe.

Why the race hit so often in checks (2 of 6 hunt runs within 10 ms): while a check waits, XCTest reads the app's whole
accessibility tree about once a second, which blocks the app's main thread; the page's landing and the 5 s read both queue
behind it and run back to back. On a phone, any main-thread stall can line them up the same way, less often. Reasoned from
the timing, not measured.

## Change

- ChatView (DEBUG): sampleEarlierAsks counts page asks in a launch; sampleDeleteOnAsk() deletes the person's newest
  message through deleteMine, 2 s before the k-th page is due. It writes one fixed trace line, "debug delete on ask".
- EarlierDroppedUITests: launch(control:drop:) with Drop .moved or .delete. The two slice 14 checks become shared helpers,
  and two new checks run them with .delete (fix and control). For the delete, "taken to the newest" is checked against
  Message 259, because the delete removes 260 and a check on 260 would pass whatever the list did.
- ui-sample.sh: EarlierDroppedUITests 2 -> 4 in the UIKit class list.
- ChatView: loadEarlier(_ caller: StaticString) names who asked (settled, top, retry, read) in the sample trace; the room
  suite's allow-list adds "caller", and two source pins follow the new call text.
- ChatView: on a landing page with rows, topVisible = false (UIKit list); KOSMOS_SAMPLE_NOTOPFIX=1 is the control;
  KOSMOS_SAMPLE_READ_ON_LAND=1 (DEBUG) makes the read's request at the moment of landing.
- ChatList.Coordinator.apply: after a change in the ids, the chat is told the current top on the next turn of the main loop.
- EarlierDoubleAskUITests (new, 2): the fix and its control. ui-sample.sh: in the UIKit class list and the earlier-pages
  trace block.

## Results

- UI, EarlierDroppedUITests x3 on the iOS 26.5 simulator: both new delete checks passed 3 of 3 (fix and control). The
  trace shows "debug delete on ask" and then "earlier pages dropped under the reader, put at the top of what remains".
  Slice 14's moved check failed once (run 3, line 74, "the first page never landed"). That is the setup flake slice 15
  instruments, in a check this slice does not change; its timing is on the card (comment 6773740316).
- node: 121 of 121 across the test files that read the touched files. Room suite 865 of 865.
