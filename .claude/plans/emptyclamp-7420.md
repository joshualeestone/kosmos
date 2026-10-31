# emptyclamp-7420: an empty iPhone chat (Josh, build 22, iOS 26.7.2, 10-30 21:23)

## Finished looks like
The next empty-chat report from a phone says where the scroll was against its content (within, past the end, or before the
top), before and after the recovery, measured from the scroll view rather than from onAppear; an empty list whose scroll is
outside its content is put back at its end; and an empty list is put right every time it is found in a chat, not only the
first time. The app builds and the chat's keyboard checks still pass on a fresh iOS 26 simulator.

## What the report shows
134 messages, 0 on screen, end and top not showing, at newest with the anchor on "end", keyboard down. Events: opened,
read 129 rows, the top marker appeared, a 16 pt sideways shift was put back, the end appeared and then left with nobody
scrolling, a second sideways shift was put back. "after one try: messages on screen again" is known to be false
(10-29: it counts onAppear, not drawn rows).

## Reading (reasoned, not measured)
On iOS 17+ every row is lazy and the list is held on an id. A list with no row, no top marker and no end marker in view
fits a scroll offset left outside the content after the rows' heights were re-estimated. The record has never carried the
offset or the content height, so this has not been checkable.

## Change
- ScrollBox: SideScrollLock, which already finds the chat's UIScrollView, hands it to a box the diagnostic reads.
- Board.scrollPlace (tested in LogicTests): within / past the end / before the top, with the top and end offsets.
- The report gains a line "scroll y, content, view, insets: <place>", and its after-the-try line reports the same measured
  place (plus "rows said to appear N", named as what it is) instead of "messages on screen again".
- Recovery (recoverEmpty): if the scroll is outside its content, put it at the content's end, then go to the newest message
  as before. Reported once per chat as before, but recovered every time the list is found empty.

## Rejected
- Changing the side lock's write now: the record shows it firing, but #7575's report found it was not the cause on 10-29,
  and without the offset numbers any change there is a guess.
- More rows on screen by eager drawing: undoes #7265 (the reason the id anchor exists).

## Weakest premise
That the empty list is an offset outside the content. If the next report says "within" while empty, the cause is drawing,
not position, and the clamp does nothing (harmlessly). Either way the report now answers it.

## Not tested
- The empty state itself has never been reproduced off Josh's phone; the clamp is unexercised by any check.
- Recovery runs only from the existing empty-list check (diagTick when the last row leaves, and the never-drew timer).
