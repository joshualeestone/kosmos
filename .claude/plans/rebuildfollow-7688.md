# rebuildfollow-7688: the follow-ups to #7420's rebuild-on-empty (its round-4 warnings)

Card: kosmos#7688. Stacked on withinrebuild-7420 (#7420), which goes first.

## Finished looks like
1. The rebuild's timing (grace, check bump, diagCheck's waits, spacing between rebuilds) lives in one place (Board), and a
   LogicTests check fails if a rebuilt list's first check could come before a second rebuild is allowed.
2. After a rebuild, the diagnostic line says "This conversation went blank and was rebuilt", read after the new list's
   grace, and only if that chat is still the one on screen. Share still there (#7420 stays open for Josh's next report).
   A plain recovery says "did not draw properly" as before. (Review 1: "redrawn" was dropped: onScreen counts rows SwiftUI
   said appeared, which can be true over a black list, and rows can leave again after it was read.)
3. Out of scope, decided: a rebuilt list whose scroll view is not found again (place unread) gets NO further recovery:
   every check after the first report runs with later: true, and Board.emptyRecovery(later: true, place: nil) is .none.
   A rebuild with no reading of the place would be blind. Seen once only as a 0.6 s read finding the new scroll view half
   laid out or missing (why item 2 now waits for the grace), never as a list left blank. Revisit if a shared report shows
   "after one try (list rebuilt): scroll: no scroll view found" with rows said to appear 0.
4. testRebuiltAfterTheKeyboardWentDown's rebuild runs 1 s after keyboardDidHide, once no finger is on the scroll (at most 4 s more), (KOSMOS_SAMPLE_REBUILD=afterhide), not on a
   14 s clock; the marker's read time comes from Board's timing.
5. testComposerGrowingKeepsMessagesDrawn says in its comment that it is a regression guard only.
- Measured: KeyboardSlideUITests 7/7 on iOS 27 and 26.5, a Release build, LogicTests.

## Decided
- Words, not silence, for a cured rebuild: hiding the line would lose the details Josh shares; saying it failed is false.
- Weakest premise: the timing check guards Board's values, not that ChatView keeps using them; a literal typed back into
  ChatView would not trip it. A row of the new list leaving at about 1 s gives a check that the spacing refuses with only a
  trace line; the scheduled check after the grace still covers it.
