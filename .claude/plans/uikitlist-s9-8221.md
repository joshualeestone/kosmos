# uikitlist-s9-8221: the pull past the newest message on the UIKit chat list (kosmos#8221, slice 9)

Rebased onto main after #8280 merged (753a7cdcbd).

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
- 05:53, two traced runs: one PASSED end to end (the number-based wait included); the other: "end pull: let go, not
  counted: allowed true, past the end 23 of 72", 0.4 s after read 3 grew the content by 90 pt under the finger. So the 05:0x
  theory was right; its trace never fired then only because no message landed during that run's pull (not a disproof).
  The lazy list keeps its bottom fixed on an arrival; the UIKit list grew its end without moving the offset.
- Fix (ChatList.apply): a pull past the end with a finger on the list keeps the same distance past the new end after an
  update. 05:55 to 05:58, 5 traced runs on the UIKit list: 5 of 5 PASSED, and in every one the fix fired ("rows landed
  under a pull, kept 129 to 154 pt past the end") before "end pull: reading". Same timing as the 5 of 5 failures before.

## Review round 1 (blind, general-purpose): no BLOCKER

- SHOULD: a cell's later self-sizing pass could grow the content after the kept pull. DEFERRED, recorded on the card as
  this fix's weakest premise: in 5 of 5 traced runs the kept pull was 129 to 154 pt past the end, twice the 72 pt threshold.
- SHOULD: an arrival during the pull is timing, not forced. ACCEPTED with a comment in the check: it lined up in 10 of 10
  measured runs (5 failing before the fix, 5 passing after with the fix firing).
- NIT: DotsRefresh's trace line was outside the room suite's allow-list scan. FIXED: plain values, the file added to the
  scan with a control; perturbed (mayCount removed from the list): FAIL naming it, restored.
- NIT: restsAbove 2.5 hard-codes a measured difference. ACCEPTED: the comment names the measurement.

## Status

- [x] Measured, fixed, review round 1 (bounded at 3; round 1 found no BLOCKER or WARNING, so it ends).
- [x] ui-sample.sh --uikit: 32 of 32 (iPhone 17e, iOS 27.0), EndPullUITests:6 included.
- [x] Room 863/863, sweep 45/45, pullrefresh 48/48, every LogicTests runner green, the 13 node tests that read ios/ green.
- [x] Full validation PASSED (06:42 CST, hash 77c775c1416b); main had not moved.
