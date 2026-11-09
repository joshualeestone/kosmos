# uikitlist-s7-8221: earlier messages on the UIKit chat list (kosmos#8221, slice 7)

## Finished looks like

On the New chat list, a reader who scrolls to the top of a chat gets the earlier messages, the same pages the lazy list
loads: "Loading earlier messages..." floats over the top while a page loads, a failure shows its line with Try again, and
the message the reader was looking at stays where it was as the page lands above it, whether the list is at rest or still
moving (a finger on it, a fling). UI checks prove it on the UIKit list in the sample board's long chat (220 rows shown, 40
older): reach the top, the loading line shows, the page lands with the reader's row where it was, and its oldest message
("Checking the venue list, item 1.") is reached by scrolling on. The lazy list is not checked by them: it asks for the page
before its top shows (measured), and its earlier pages are #7016's and #7265's, unchanged here. The Settings footer stops saying earlier messages are
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

- [x] Plan (23:5x CST 11-08).
- [x] Steps 1-3 (83736cc34d): atTop in ChatList, the chat's loadEarlier on it, the failed cell, the loading overlay, keepAnchor
      left to the lazy list. Room checks 858/858; CONTROL, the loadEarlier call removed: 1 FAIL. 15 node tests reading ios/
      102/102 (found by git grep).
- [x] Step 4 (14ea1b9024): EarlierPagesUITests, UIKit arm only (the lazy list asks for the page before its top shows, so
      it has no "at the top, not yet landed" moment; measured). KOSMOS_SAMPLE_OLDER_DELAY holds the sample page 4 s.
      Three designs measured: fast swipes overshoot into the page (2 of 2 failed on both arms); waiting on the day line
      (it sits under the header at the very top and reads as not hittable) failed 8 of 8; waiting on the loading line, the
      product's own signal, passed 8 of 8 (00:59-01:13, iPhone 17e iOS 26.5). CONTROL on main: fails at "did not say
      earlier messages are loading". ui-sample.sh --uikit: 15 of 15 (with the earlier design flaky; rerun on the final).
- [x] Step 5: the footer drops "Earlier messages," (01:18 CST). Shots ~/work/design-shots/kosmos-8221-s7/ (light and dark on,
      largest text: reads in full, switch in place).
- Open, decided: a reader who stops within the list's top 40 pt asks for the page; one who stops 41 to about 80 pt short,
  with the day line showing, does not until they reach the top. Rejected: a larger slack (the lazy list asks a screen
  early); weakest premise, that a person rests in that band rarely.
- [x] Review round 1 (opus): BLOCKER, a page landing while the list moves (a finger on it, a fling) was never held, as the
      hold runs only at rest, and the reader was left at the top of the new page. MEASURED by trace (01:29, 01:33: the scroll
      ended at y -12 with the content grown by the page). Fixed in apply(): the row at the top of the screen, if it stays, is
      put back at its distance in the same update, moving or not, and the top is read again. New check
      testAPageLandingUnderTheFingerKeepsThePlace (page lands 1 s after asked, inside a drag): 3 of 3 with the fix; CONTROL
      without it, FAILS at "threw the reader to its oldest message". WARNING, a failed page's line held off screen above a
      reader at the top: shown at the top instead. WARNING, a remade list could inherit a stale top: a new list tells the
      chat it is not at the top. WARNING, the 4 s window could pass on a slow runner: 12 s, landing timeout 20 s. NIT, an
      assertion that could not fail: removed. NIT, this Finished line: corrected. Main check 3 of 3 after the fix (01:55 CST).
- [ ] Full validation, review round 2, ui-sample both arms on the final head (CI), PR, merge on green.
