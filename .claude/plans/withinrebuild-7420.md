# withinrebuild-7420: a chat found empty within its content at the newest message is rebuilt

Card: kosmos#7420. TestFlight build 24 (with #7669) gave four reports from Josh that read WITHIN: the scroll inside the
content, the reader at the newest message, no row drawn, and #7669's one try (go to the newest) left it empty. Triggers:
the keyboard's height changing in a burst (318 -> 345, the shown height 439 -> 412 -> 362), the keyboard going down, and
the message box growing a line at a time (412 -> 390 -> 368 -> 346). Long (144 messages) and short (13, 27) chats alike.

## Finished looks like
- Board.emptyRecovery gains `.rebuild`: empty, within the content, the reader at the newest (atBottom), nobody scrolling,
  on the first empty reading or a later one. A reader higher up, a finger on the list, or a scroll outside the content
  keep #7669's arms.
- The chat's list gets an identity (`listEpoch`); `.rebuild` gives it a new one. The new list starts as a chat's open does:
  no anchor (its first rows drawn), then goNewest 0.05 s and 0.4 s later, unless the person has started scrolling.
- At most 3 rebuilds a chat open (per open, not per episode), 2 s apart, and the empty check ignores the 1.5 s after a
  rebuild (the new list's own moment without rows read as empty and rebuilt itself three times on iOS 27, traced); one
  check is scheduled just after that grace, since a new list that draws no row never has a row leave to set one off.
- Rows and the top and end markers count only for the list they were drawn in (listEpoch), so the old list's teardown
  cannot clear the new one's state.
- A later empty reading can now rebuild (it used to do nothing within the content). It is reached only through
  diagCheck: no row counted, the end not showing, the top not showing, at the newest, nobody scrolling.
- Debug only: KOSMOS_SAMPLE_REBUILD=<seconds> runs the real recovery once (its marker shows only if the list was rebuilt
  exactly once); KOSMOS_SAMPLE_NOREBUILD=1 is the control.
- UI checks (KeyboardSlideUITests): a long chat, a short chat, and a chat after the keyboard went down are rebuilt once and
  show the newest message above the box (and above the keyboard); the message box growing four lines keeps messages drawn (a regression guard: it passes with or without the rebuild).
- LogicTests: emptyRecovery's .rebuild on each side (finger, reader higher up, outside the content).

## Measured (10-31)
- iOS 27 and iOS 26.5 simulators (iPhone 17e): KeyboardSlideUITests 7/7 on each (14/14). Control (rebuild off): the three
  rebuild checks fail, 3/3.
- Traced on the way: a rebuilt long list created already anchored on "end" stayed empty on iOS 27; created with no anchor
  and no ask it stayed at its top. The rebuilt list's own empty moment rebuilt it again without the grace.

## Not in scope, named
- The cause on the phone (rows not drawn within the content after the shown height changes) is not reproduced on the
  simulator; the rebuild is the recovery, checked through the debug hook. Josh's next report on a build with this decides.
- The newest message ending behind a grown message box (seen while checking the composer case) is a separate fault, noted
  on #7420.

## Decided
- Rebuild rather than another scroll: the scroll was where the newest messages are and none was drawn there; #7669's try
  moved it and the list stayed empty, so a new list is what can draw them.
- Only at the newest: a reader higher up would lose their place.
- Weakest premise: that a new list draws its rows on the phone where the old one did not. The simulator never had the old
  list's fault, so it can show the rebuild works, not that it cures the phone's case.
- Review loop bounded at 4 rounds; remaining WARNINGs then go on a card.
