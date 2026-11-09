# uikitlist-s7-8221: earlier messages on the UIKit chat list (kosmos#8221, slice 7)

## Finished looks like

On the New chat list, a reader who scrolls to the top of a chat gets the earlier messages, the same pages the lazy list
loads: "Loading earlier messages..." floats over the top while a page loads, a failure shows its line with Try again, and
the message the reader was looking at stays where it was as the page lands above it. A new UI check proves it on both lists
in the sample board's long chat (220 rows shown, 40 older): reach the top, the oldest message ("Message 1 of 260") arrives,
and the row at the top before the page landed is still on screen. The Settings footer stops saying earlier messages are
missing.

## Why now

Slices 4 to 6 put the UIKit list on a phone behind a switch (TestFlight build 59). Its footer names three gaps: earlier
messages, long press to copy or delete, and some of the scrolling. Earlier messages is the one a reader of a long chat hits
first, and slice 1's plan numbers it next.

## Decided

- The list tells the chat when the reader is at its top, as it already tells it about the end: ChatList gets
  `atTop: (Bool) -> Void`, told on a change only, never during a layout pass. At the top means the offset is within
  ChatList.endSlack of the list's top (the same 40 pt the end uses), read when a scroll ends, during the person's own
  scroll, and after a layout (a chat too short to scroll is at its top at once, as the lazy list's top marker appears at
  once). Rejected: a marker cell's appearance, as the lazy list does. A hosted cell's onAppear fires as the cell is
  prepared, and a reused cell's timing is not the reader's position. Weakest premise: that 40 pt is near enough; the lazy
  list's marker is 1 pt tall and appears only at the very top.
- The chat sets topVisible from it and calls loadEarlier(), as the lazy list's top marker does. loadEarlier's own guards
  (fullRead, search, settledAtEnd, Board.shouldAsk) stay the gate, for both lists.
- The page landing keeps the reader's place through slice 3's hold (the top row on screen held at its distance). The lazy
  list's keepAnchor (a scrollTo by id) is not used on the UIKit list: it would act on the lazy list's proxy, which is not
  there. Weakest premise: slice 3's hold sees the page's rows as rows landing above; its NewMessagesUITests check proves
  rows LEAVING the top, not arriving.
- The loading line floats over the list as on the lazy list (an overlay, taking no room, so nothing moves). The failed line
  is the list's first cell ("earlier-failed"), as it is the lazy list's first row.
- Release behaviour of the lazy list is unchanged.

## Steps

1. ChatList: `atTop` callback and its reading (scroll end, person's scroll, laidOut); trace on a change.
2. ChatView conversationUIKit: atTop sets topVisible and calls loadEarlier(); the "earlier-failed" id first when
   earlier.because is set and not searching; earlierLoadingLine as an overlay; keepAnchor left to the lazy list.
3. Room suite source checks for the wiring.
4. A UI check, both arms: EarlierPagesUITests (long chat, scroll to the top, the oldest message arrives, the row held stays
   on screen). Added to ui-sample.sh's classes for both arms.
5. Settings footer: drop "Earlier messages," from what is missing. Design shots of the footer, light and dark.
6. All LogicTests suites, the node tests that read ios/ (git grep, never a filename glob), ui-sample.sh both arms, full
   validation, review bounded at 4 rounds, PR, merge on green.

## Status

- [ ] Plan (23:5x CST 11-08).
