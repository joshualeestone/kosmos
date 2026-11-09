# uikitlist-s9-8221: the pull past the newest message on the UIKit chat list (kosmos#8221, slice 9). WORK IN PROGRESS

Stacked on uikitlist-s8-8221 (PR #8280). Rebase onto main once it merges.

## Finished looks like

EndPullUITests (6 checks, #8072) pass on the UIKit list with each chat launch asserted drawn by it, and run in CI's UIKit
job (ui-sample.sh --uikit). The pull past the newest message shows the dots, reads, and the list bounces back, as on the
lazy list.

## Measured (11-09, iPhone 17e iOS 26.5)

- Before (EndPull given UIKitListArm.set + assertDrawn, no product change): 2 of 6 (only the two "nothing happens" checks;
  every pull check: "no dots after a long pull").
- Attaching the EndPullDriver to the UIKit list's scroll view (ChatList hands it via `scroller`): 4 of 6.
- The dots' rest height on the UIKit list: measured -0.5 pt under the working line and 33.5 above the box (same 33 pt
  as the lazy list's 11.5 + 21.5), so restsAbove is 2.5 there (14.5 on the lazy list): testALongChatPullBouncesBackUnderTheDots
  then PASSES.
- OPEN: testAMessageLandingAroundAPullShowsAndNothingBlanks.
  - Run at 05:05: failed at line 133 "no dots after a long pull".
  - A theory (rows landing under the pull shrink it below the threshold) was built and then DISPROVED: its trace line never
    fired in the next run (no rows arrived during a pull). The change was removed.
  - Run at 05:10 (with that never-engaged change): the dots DID show ("Refreshing" at 33.2 s, "end pull: reading" in the
    trace), and it failed later, line 138 "no later message reached the list" (15 s after the dots went).
  - So: the "no dots" failure is intermittent (not explained), and line 138 is a second, separate open question. It may be
    a real defect (a later message not drawn after a pull on the UIKit list) or the check counting "New message" static
    texts, which on the UIKit list exist only for cells on screen (the lazy list keeps more of its rows in the tree).
  - NEXT: run that check alone 5 times with KOSMOS_SAMPLE_TRACE=1 and read, per run, which line fails; then look at the
    screen (a frame from the recording) at line 138 to tell a missing message from an off-screen one.

- 05:36 to 05:50, after rebasing on main (#8280 merged): the check changed to wait for the NEXT message by its number
  ("New message N+1 "), since the UIKit list keeps only on-screen cells and a count can stay level; "New message " with a
  space so the "New messages" capsule does not count. Then 7 runs of the check alone: UIKit list 5 of 5 FAILED at "no dots
  after a long pull" (line 134); lazy list 2 of 2 passed. So "no dots" is not intermittent on the UIKit list: it is the
  failure, and the 05:10 run that got dots was the outlier. Line 138 is untested until the dots show.
- Added a trace for a pull let go without counting (allowed?, how far past the end, of the threshold) and turned the trace
  on in this check; two traced runs queued.

## Status

- [x] Measured (above). [x] ChatList.scroller, ChatView attaches EndPullDriver, restsAbove 2.5 on the UIKit list.
      [x] Room checks: slice 9's attach, slice 7's pinned line updated (862/862). EndPull asserts the UIKit list drew it.
- [ ] The open check above; then ui-sample.sh --uikit with EndPullUITests:6, validation, review, PR.
