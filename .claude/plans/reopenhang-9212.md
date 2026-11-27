# reopenhang-9212: re-opening a chat of tall replies no longer freezes the app (kosmos#9212)

## Finished looks like
Re-opening Dana's tall20 sample chat (20 tall replies) many times in one launch never freezes the app on the iOS 26.5
simulator, the chat still opens on its newest message (ChatTallOpenUITests), and the old open (KOSMOS_SAMPLE_ANCHORATOPEN=1)
still freezes under the new check, so the check can see the defect.

## What was measured (probe branch reopenprobe-9212, never merged; iPhone 17e, iOS 26.5, runs of 10 re-opens)
- As shipped (build 75): froze in 6 of 10 runs. Build 73 (before #9089): 3 of 12 (Ice Cream Kitty), so older than #9089.
- #9089's looks off: 1 of 7. Working dots still: 1 of 3. Working row hidden: 2 of 4. Dana idle: 0 of 4 (chance at this rate).
- Id anchor off (KOSMOS_SAMPLE_NOPOSID=1, the iOS 16 path): 0 of 6. So the scrollPosition(id:) anchor is needed.
- Signature of every freeze: one body with the thread, the open's goNewest names positionId "end", the working row is built,
  then no view body ever runs again; main thread 100% in LazySubviewPlacements.makeIDPlacementContextIfNeeded.
- Naming the anchor one main-loop turn later (DispatchQueue.main.async): froze 3 of 3, at re-open 2. Rejected.
- Opening with a one-off proxy.scrollTo("end") and naming the anchor when the end marker appears: 0 of 8 (80 re-opens). Chosen.

## The change
- ChatView: the open scrolls to "end" without naming the anchor and sets a one-shot flag (anchorOnEndAppear); the end
  marker's onAppear uses it up and names positionId "end" if nothing else named one and no person is scrolling. A person's
  scroll and a fresh chat clear the flag. #9089's looks (landOnNewest) scroll the same way and re-arm the flag.
- KOSMOS_SAMPLE_ANCHORATOPEN=1 (Debug only) restores the old open: the control.
- ChatTallOpenUITests: a third check re-opens the chat 8 times in one launch; TEST_RUNNER_KOSMOS_ANCHORATOPEN=1 runs it
  against the old open. ios/tools/ui-sample.sh: the class count is 3.

## Rejected
- Turning the id anchor off: #7265 added it so a reader's place holds while messages arrive.
- Deferring the anchor by one turn: measured worse (above).
- Quarantining ChatTallOpenUITests: it is the one CI signal for this hang.

## Weakest premise
The simulator, not a phone. And between the open and the end's appearance (a frame or two) no anchor holds the list;
a message arriving in that window is followed by the arrival paths that name "end" themselves.
