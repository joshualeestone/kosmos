# roomtrace-7645: the room's newest-above-the-box check records its scroll trace

Card: kosmos#7645. RoomKeyboardUITests.testRoomNewestStaysAboveTheBox failed on main (run 41780837713) and on PR #7917
("Post 220 was gone after the keyboard came up"). It is the one check in the class launched without KOSMOS_SAMPLE_TRACE,
so the trace ui-sample.sh prints on a failure holds nothing from it, and the cause cannot be read.

## What finished looks like
The check launches with KOSMOS_SAMPLE_TRACE=1, so its next failure on CI prints its own keyboard-hold lines.

## Change
ios/KosmosUITests/RoomKeyboardUITests.swift: the launch passes KOSMOS_SAMPLE_TRACE=1, as its two siblings do. Debug-only
switch; nothing in the app changes.

## Decided
- Diagnose before fixing: the other room traces in the file come from other checks, and guessing a fix from them would be
  building on a premise not measured.
- Weakest premise: that tracing does not change the timing enough to hide the failure. The sibling checks trace and still
  fail sometimes.
