# uikitlist-s14-8221: a reader up in dropped earlier pages goes to the top of what remains

Card: joshualeestone/kosmos#8221, slice 14. Off main 87266ca457.

## Scope

Found in slice 7's review (round 3), pre-existing on both lists: when a read answers "moved" and the loaded earlier pages
are reset and dropped, a reader up in those pages has no row on screen left to keep, so the list keeps its old offset
number and they land in an unrelated part of the chat. The same drop happens on a moved gap fill, a delete with earlier
pages open, and Try again after a thread that kept moving.

Not in scope: the lazy list (being replaced; its keepAnchor runs only for a page). The card's other open items.

## Finished looks like

On the UIKit list, a reader whose rows on screen are all in dropped earlier pages is at the top of what remains (the
oldest row still loaded) right after the drop, not at the newest and not at the old offset; the page before is then asked
for again and lands above them without moving them. A control with the fix off shows the reader elsewhere, so the check can
see the defect.

## Decided

Top of what remains. Rejected: the newest message (loses their place entirely). Weakest premise: that the top of what
remains is nearer what they read than the newest is. Would change my mind: a "moved" that means history was replaced
wholesale.

## Change

- ChatView: earlierDropped, bumped by restartEarlier whenever loaded earlier rows go to none (moved page, moved gap fill,
  delete, Try again); passed to ChatList as dropped.
- ChatList: dropped; Coordinator.apply(ids, dropped:) puts a reader at the top when pages were dropped since the last
  update, they are not at the newest, and no row on screen stays (anchor nil). A reader with a row that stays is held by it,
  as before. KOSMOS_SAMPLE_NODROPFIX=1 (DEBUG) switches it off: the control.
- BoardClient (DEBUG): KOSMOS_SAMPLE_OLDER_PAGE=<n> serves sample pages of n; KOSMOS_SAMPLE_OLDER_MOVED=<k> answers the
  k-th sample page "moved".
- ios/KosmosUITests/EarlierDroppedUITests.swift: a reader one drag into the first page, with a fix-off control. UIKit arm
  only.

Tried and removed (review 3, then 7): telling the chat again when a reader already waiting at the top stays at the top
(their atTop does not change). Its fix-off control failed: the page was asked for again within 2 s anyway (measured 11-10
03:1x, by another path; reasoned to be the chat's loadEarlier after each read). With no check able to show it did
anything, both the code and its at-top check went. Also measured at 03:4x: at the first page's very top no row of it read
as present, so a reader there is not a case these checks can see.
- ios/tools/ui-sample.sh: EarlierDroppedUITests:2 in the UIKit class list.

## Coverage

Measured: the moved page path only (EarlierDroppedUITests). The moved gap fill, a delete with earlier pages open and Try
again after a thread that kept moving all go through restartEarlier and the same ChatList branch; covered by reasoning, not
by a check. A fling running at the drop is stopped first (as toNewest does); not measured.

## Results

On this Mac (iPhone 17e simulator, iOS 26.5, UIKit arm), the first two checks, 01:41, 02:14 and 02:39 CST: 2 of 2 each
time (fix arm: Message 41 at the top after the drop, held as the page asked for again lands; control, fix off: Message 41
not on screen after the drop). 03:06 and 03:4x: the at-top checks, since removed (above). Final run: see the PR.
