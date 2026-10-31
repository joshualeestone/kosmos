# rebuildfollow-7688: the follow-ups to #7420's rebuild-on-empty (its round-4 warnings)

Card: kosmos#7688. Stacked on withinrebuild-7420 (#7420), which goes first.

## Finished looks like
1. The rebuild's timing (grace, check bump, diagCheck's waits, spacing between rebuilds) lives in one place (Board), and a
   LogicTests check fails if a rebuilt list's first check could come before a second rebuild is allowed.
2. After a rebuild that brought messages back, the diagnostic line says "went blank and was redrawn", read after the new
   list's grace; Share still there (#7420 stays open for Josh's next report). A rebuild that did not cure it, or a plain
   recovery, says "did not draw properly" as before.
3. Out of scope, decided: a rebuilt list whose scroll view is not found again (place unread) takes the newest-message
   recovery, not another rebuild. Rebuilding with no reading would be blind; nothing measured shows the scroll view
   going missing after a rebuild. Revisit only if a report's diagnostic shows "scroll: no scroll view found" after a rebuild.
4. testRebuiltAfterTheKeyboardWentDown's rebuild runs 1 s after keyboardDidHide (KOSMOS_SAMPLE_REBUILD=afterhide), not on a
   14 s clock; the marker's read time comes from Board's timing.
5. testComposerGrowingKeepsMessagesDrawn says in its comment that it is a regression guard only.
- Measured: KeyboardSlideUITests 7/7 on iOS 27 and 26.5, a Release build, LogicTests.

## Decided
- Words, not silence, for a cured rebuild: hiding the line would lose the details Josh shares; saying it failed is false.
- Weakest premise: that onScreen non-empty 1.8 s after a rebuild means the messages are really drawn (onScreen counts rows
  SwiftUI said appeared, #7420 10-29). The line can still say "redrawn" over a list that is drawn but out of place.
