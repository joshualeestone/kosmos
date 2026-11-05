# #7420: a list past its end is not "at the newest already"

Addresses #7420.

## What finished looks like
When the keyboard finishes rising and the list is past its end, did-show moves it to the newest at once, as it did before #7953. A list truly at its end is still left alone, so the jumping fix holds.

## Measured
Josh's capture on build 43 at 21:11: y 30255, content 30393, view 932, bottom inset 407, so the end is 29868 and the list sat 387 pt past it with no row drawn. The trace says "keyboard shown, at the newest already", my skip from #7953, because shortOfEnd reads 0 past the end.

## Decided
- Guard in place at the skip, using the existing place reading. Rejected changing shortOfEnd: settledPutBack and others read it and expect 0 past the end.
- Weakest premise: this shortens a blank, and does not prevent one. Why the rise left the list 387 pt past its end is unknown. The settled look and the recovery already put it back within about a second, so the gain may be small.
- A source check, because the handler lives in a view: the logic suites cannot run it. No phone has run this.
