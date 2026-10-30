# uitrace-7609: ui-sample.sh runs all three keyboard checks again, and prints the scroll trace when one fails

Card: kosmos#7609 (owed to Mona Lisa, agreed 07:05 10-30, m1740 / m1837).

## Change (ios/tools/ui-sample.sh only)
- KeyboardSlideUITests back to 3 in the run (the skip of testReadHigherUpStaysWhereItWas removed): Mona Lisa's #7627
  (kbrested-7609) replaced the clock wait that made it flake with a marker.
- On a FAILED testReadHigherUpStaysWhereItWas, before cleanup deletes the simulator: the bundle id from the built
  Kosmos.app's Info.plist (CFBundleIdentifier, never hard-coded), its data container via simctl get_app_container,
  and the last 60 lines of Documents/trace.txt (the check runs with KOSMOS_SAMPLE_TRACE=1). Copied from
  ui-keyboard.sh, which does the same.

## Verified
- A full run: PASS 11 of 11 on a fresh simulator (iPhone 17e, iOS 27.0).
- CONTROL, the dump firing: the check forced to fail (an XCTFail added for one run, then reverted, never committed):
  the script printed "the chat's last scroll events" and ten TRACE lines, exit 1.
- The ios workflow's ui job keys only on `^PASS  ui-sample:`; nothing else reads the script.

## Weakest premise
That the restored third check holds on CI's iOS 26.5 runner. If it flakes there, the trace now says why, which is
what #7609 stays open for.

## The first CI run's trace, and the fix (10-30, 11:14 to 12:5x)
- PR #7632's first CI run (iOS 26.5) failed the restored check, and the new trace explained it: the reader's row moved when the keyboard came up.
- Reproduced on a local iOS 26.5 simulator (runtime installed for it): 6 of 6 runs fail, with the side lock ON (row moves) and OFF (row leaves the screen), and with the id anchor OFF (row leaves the screen). iOS 27: passes, even with a forced sideways shift at keyboard-up. So it is iOS 26's own keyboard handling, not this app's side lock or id anchor.
- Fix: KeyboardHold (ios/Kosmos/ChatView.swift). When the keyboard starts to show while the reader is not at the newest message (the exact opposite of the chat's own keepNewestInView), it keeps the scroll view's vertical offset, and puts it back once the keyboard is up (now and after the next layout) if iOS moved it and nobody is scrolling. The trace records only how far it moved.
- Measured on iOS 26.5: with the hold 2 of 2 pass (the trace shows iOS moved it 10602 to 11647, put back); CONTROL KOSMOS_SAMPLE_NOKBHOLD=1 fails. iOS 27: ui-sample 11 of 11. The trace guard's allow-list gains the one number (Int(moved)).
