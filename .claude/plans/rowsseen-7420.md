# #7420: a report says where the rows sit against the screen

Addresses #7420.

## What finished looks like
The next capture of a blank says, after a rebuild, where the drawn rows are and what the screen shows, so a blink that recovered and a screen that stayed blank read differently. It changes no behaviour.

## Measured
Josh's capture on build 43: the recovery ran and landed at the end with 2 rows "said to appear". That word is SwiftUI's, and an earlier capture had rows appear on a black list. So whether it recovered cannot be read from it.

## Change
`Board.rowsAgainstScreen` and `ScrollBox.showing`, appended to the report's "after one try" line.

## Decided
- A record, no judgement. Rejected counting rows outside the visible area as blank now: nothing yet shows that happens, and a wrong blank rebuilds, which moves the reader.
- Weakest premise: RowReading.content and contentOffset share one coordinate space. readingsHere's own formula treats them as close to that (offset plus the row's place on screen, with the top inset), and the numbers will show it if not. Readings are off below iOS 26, and the line then says so.
- Tops only: a row's height is not read, so a tall row starting above the screen can still cover it. Reading the numbers needs that in mind.
