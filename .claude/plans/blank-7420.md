# blank-7420: the empty-chat record reads the scroll view; an empty list is put back after the report too

Card: kosmos#7420 (Josh 10-29 21:22, build 19, iOS 26.7.2: a 114-item DM went empty; the record said "messages on screen
again" after one try, but his screenshot, taken after that line, was still empty).

## Finished looks like
- The diagnostic record carries the list's scroll view numbers (offset, content height, shown height, insets) and whether
  the shown band misses the content (`Board.scrollBand`, where showing only the padding and markers at either end
  counts as missing it), at capture, in the trace once a resize has held for 0.5 s, and
  twice after the one try (0.6 s and 1.5 s).
- "After one try" never reads as recovered on the row count alone: it says "still nothing on screen" when the band is
  off the content or no row is counted, "not judged yet" when the list was not measured, and "shows the content again"
  only with the band measured on the content and rows counted. The count is written beside it.
- A resize that has held for 0.5 s, or the person's scroll coming to rest (iOS 18 and later, where the scroll phase is
  reported), with the band off the content triggers the
  check (no row leaving would bump the tick). A band moved off the content by anything else, with rows still counted,
  is not checked until one of those or a row leaving happens.
- An empty list must read empty at 0.5 s and again at 1.5 s, with the list still, before anything is done.
- After the one report, an empty list is still put back (to the newest message), at most once in 2 s and 3 times a chat,
  and each of those is added to the report the person can share (while it is on screen), with which arm read empty.
- The report is written only if no account or computer change came between the capture and its 1.5 s reading, and the
  chat is still on screen.
- `Board.scrollBand` is tested in LogicTests with a control on each side of each boundary.
- A UI test (`ChatBlankUITests`, skipped unless `TEST_RUNNER_KOSMOS_UI_BLANK=1`) walks Josh's steps on the sample chat.

## Not in scope
- The cause of the empty list. Not reproduced: the simulator run (iPhone 17 Pro Max, iOS 27.0, 260-message sample) went
  through keyboard up, drag-dismiss, three flicks up and keyboard up again with the band on the content throughout.
  The next real report will say which kind of empty it is (band off the content, or rows not drawn on it).

## Decided
- Recovery goes to the newest message (goNewest), as the existing one try does, and with the band off the content it also
  moves the scroll view to its end directly (review 11: re-setting the anchor alone may move nothing if SwiftUI already
  holds the list at "end"). Known risk: that write is under SwiftUI's scroll position, which may then anchor on a row
  rather than "end"; it is proven only by the opt-in UI test (passed 10-29 23:27 on the iOS 27 simulator: the control's
  newest message came back), and the after-one-try readings will show it on a phone. Rejected: re-setting the message anchor,
  because the anchor is the thing suspected of holding the bad place. Weakest premise: a reader scrolled far up loses
  their place on recovery; an empty screen is worse than a lost place, it needs two still, empty readings, and it is at
  most once in 2 s and 3 times a chat, so a wrong reading cannot keep moving a reader.
