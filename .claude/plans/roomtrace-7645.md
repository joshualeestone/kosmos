# roomtrace-7645: the room's newest-above-the-box check records its scroll trace

Card: kosmos#7645. RoomKeyboardUITests.testRoomNewestStaysAboveTheBox failed on main (run 41780837713) and on PR #7917
("Post 220 was gone after the keyboard came up"). It is the one check in the class launched without KOSMOS_SAMPLE_TRACE,
so the trace ui-sample.sh prints on a failure holds nothing from it, and the cause cannot be read.

## What finished looks like
The check launches with KOSMOS_SAMPLE_TRACE=1, so its next failure on CI prints its own keyboard-hold lines.

## Change
- ios/KosmosUITests/RoomKeyboardUITests.swift: the launch passes KOSMOS_SAMPLE_TRACE=1, as its two siblings do. Debug-only
  switch; nothing in the app changes.
- ios/tools/ui-sample.sh (review 1): the trace was printed only when one of the two read-higher-up checks failed, so this
  check's failure would still print nothing. It now prints on this check's failure too, and always the WHOLE file: the
  file is appended by every traced launch, and a tail after this check (which runs before the room's read-higher-up check)
  could hold only the checks after it.

## Decided
- Diagnose before fixing: the other room traces in the file come from other checks, and guessing a fix from them would be
  building on a premise not measured.
- Weakest premise: that tracing does not change the timing enough to hide the failure. The sibling checks trace and still
  fail sometimes.
- Review 2: the dump names every keyboard check that ran, in order, read from the log (not a fixed list that skipped the
  drag check and the chat checks whose lines are in the file); the room writes "room shown" when it opens (Debug, sample
  rooms; "room back" on a later appearance, review 3), so each room launch has a start line as the chat's "chat shown"
  gives each chat launch; and the drag check (which already traced) is now one of the failures that print the trace.
- Review 4: the room traces what decided "keep the newest" at keyboard will-show (visible, at end, search), the case the
  newest post is lost in; skipped checks appear in the order list; "room shown" is per room view, not per launch.
