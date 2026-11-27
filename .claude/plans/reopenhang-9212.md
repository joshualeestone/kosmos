# reopenhang-9212: re-opening a chat of tall replies no longer freezes the app (kosmos#9212)

## Finished looks like
Re-opening Dana's tall20 sample chat (20 tall replies) many times in one launch never freezes the app on the iOS 26.5
simulator, the chat still opens on its newest message (ChatTallOpenUITests), and the old open (KOSMOS_SAMPLE_ANCHORATOPEN=1)
still freezes under the new check, so the check can see the defect (a by-hand control run, recorded on the card; CI runs the
check on the fix only).

## What was measured (probe branch reopenprobe-9212, never merged; iPhone 17e, iOS 26.5, runs of 10 re-opens)
- As shipped (build 75): froze in 6 of 10 runs. Build 73 (before #9089): 3 of 12 (Ice Cream Kitty), so older than #9089.
- #9089's looks off: 1 of 7. Working dots still: 1 of 3. Working row hidden: 2 of 4. Dana idle: 0 of 4 (chance at this rate).
- Id anchor off (KOSMOS_SAMPLE_NOPOSID=1, the iOS 16 path): 0 of 6. So the scrollPosition(id:) anchor is needed.
- Signature of every freeze: one body with the thread, the open's goNewest names positionId "end", the working row is built,
  then no view body ever runs again; main thread 100% in LazySubviewPlacements.makeIDPlacementContextIfNeeded.
- Naming the anchor one main-loop turn later (DispatchQueue.main.async): froze 3 of 3, at re-open 2. Rejected.
- Opening with a one-off proxy.scrollTo("end") and naming the anchor when the end marker appears: 0 of 8 (80 re-opens). Chosen.
- Clean branch, iteration 2 code (d3aaeb719b): ChatTallOpenUITests x4, 12 of 12 passed (32 re-opens in the re-open check).
- Clean branch after review rounds 6 and 7 (0079264007), which treated only an EMPTY binding as "no anchor yet": the tall
  chat froze on its second open, 2 of 2. After the open's scroll SwiftUI writes a row id into the binding itself, so those
  guards let the looks and goNewest name "end" over estimates again. Restored: during the open's request a row id counts
  as not anchored (positionId != "end"), as in the iteration 2 code.

## The change
- ChatView, the open: when nothing names "end" yet, it goes there with a one-off proxy.scrollTo and names no anchor, and sets
  a one-shot request (anchorOnEndAppear) that lapses 0.3 s after the open's last look (1.9 s; a counter ties each lapse to
  its own open). While the request is set and nothing has named "end", goNewest (an arrival, a read that follows the newest)
  only scrolls, unanimated, as goNewest always is under the anchor, and so do the paths that wrote "end" directly (the box
  height, keyboard and tray follows and settleAtNewest's put-back, now through nameEnd()). The two delayed put-backs that
  name "end" after an offset write wait on the same condition. A row id in the
  binding during the request is SwiftUI's own (above), so it does not end the wait.
- The end marker's onAppear names "end" whenever nothing holds an anchor (positionId nil) and nothing let it go: not under a
  person's scroll (personScrolling, or UIKit's under-a-finger reading, since iOS 17 sets no personScrolling), not after a
  let-go (anchorLetGo), not in search. Its rows are drawn then. That also covers an end that first shows after the lapse,
  and a short chat whose end appears before the open runs (the open then finds "end" named and does nothing).
- A refused read that drops the list also drops its anchor and any let-go, so the next list starts with no anchor and its end
  names one. A person's scroll that rests on the end before anything named the anchor names it (PersonScroll's rest).
- A person's scroll (iOS 18+), a fresh chat and a list rebuild clear the request. #9089's looks scroll the same way and
  re-arm it within the open's window.
- KOSMOS_SAMPLE_ANCHORATOPEN=1 (Debug only) restores the old open: the control.
- ChatTallOpenUITests: a third check re-opens the chat 20 times in one launch (at the old rate, about 7% a re-open,
  that shows a returning freeze about three runs in four); TEST_RUNNER_KOSMOS_ANCHORATOPEN=1 runs it
  against the old open. ios/tools/ui-sample.sh: the class count is 3. LogicTests/room: the source pins follow the
  changed lines, and one new check pins the #9212 lines (and that no direct scroll-and-name write is left).

## Rejected
- Turning the id anchor off: #7265 added it so a reader's place holds while messages arrive.
- Deferring the anchor by one turn: measured worse (above).
- Quarantining ChatTallOpenUITests: it is the one CI signal for this hang.

## Left as it is, deliberately
- recoverEmpty's rebuild (a blank list, rare) still names "end" through goNewest on a fresh list after its first layout. Not
  measured to freeze; the probe never rebuilt. Changing it unmeasured would trade one unknown for another. If it ever shows,
  the same treatment applies.
- The new check asks that each re-open draws the chat and its newest message, not that the newest is wholly on screen: the
  landing is the other two checks' job, and a freeze draws nothing at all.
- Until the end appears no id anchor holds the list, so an earlier page landing above before then is not held by it. A
  tall chat's top is far from its end; the end's own appearance names the anchor before its settled page is asked for
  (loadEarlier("settled") runs a turn later).
  A person who reaches the top in those frames can ask for the page before (loadEarlier("top")) with no anchor to hold it;
  that is the same narrow window.

- On iOS 17, where a person's scroll is not reported, a reader who drags in the open's first 1.9 s and then sends has the
  send only scrolled to the newest, not anchored there, until the request lapses. iOS 18 and later end the request on
  their scroll.

## Weakest premise
The simulator, not a phone. And between the open and the end's appearance (a frame or two) no anchor holds the list;
an arrival in that window is followed by goNewest's scroll. The sample board's re-reads bring nothing new, so the
measurements never exercised an arrival during the open.
