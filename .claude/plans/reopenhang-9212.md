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
- Fix as shipped (c5b765bc59, ChatView identical to d3aaeb719b): ChatTallOpenUITests x4, 12 of 12 (80 re-opens in the
  20-re-open check); the probe as Ice Cream Kitty ran it, 12 iterations of 10 re-opens: 0 of 12 hung.
- Controls that afternoon, the old open restored by KOSMOS_SAMPLE_ANCHORATOPEN=1: the 20-re-open check 0 of 4 runs froze
  (80 re-opens), the probe 1 of 6 (60). So the old open froze far less often then (about 1 re-open in 140) than in the
  morning (about one run of 10 in two), and the afternoon's clean runs on the fix are weaker evidence than the morning's
  rates suggest. A same-session A/B (fix and old open, 12 probe iterations each) is the measurement that separates them.
- Clean branch after review rounds 6 and 7 (0079264007), which treated only an EMPTY binding as "no anchor yet": the tall
  chat froze on its second open, 2 of 2. After the open's scroll SwiftUI writes a row id into the binding itself, so those
  guards let the looks and goNewest name "end" over estimates again. Restored: during the open's request a row id counts
  as not anchored (positionId != "end"), as in the iteration 2 code.

## The change (ChatView.swift exactly as measured at d3aaeb719b, iteration 2)
- The open: an end already seen is anchored at once; otherwise it goes to "end" with a one-off proxy.scrollTo, names no
  anchor, and sets a one-shot request (anchorOnEndAppear).
- The end marker's onAppear uses the request up and names positionId "end" unless it already is, a person is scrolling
  (personScrolling, or UIKit's under-a-finger reading), or search is open. Until then goNewest only scrolls.
- #9089's looks scroll the same way and re-arm the request; a person's scroll (iOS 18+), a fresh chat and a list rebuild
  clear it.
- KOSMOS_SAMPLE_ANCHORATOPEN=1 (Debug only) restores the old open: the control.
- ChatTallOpenUITests: a third check re-opens the chat 20 times in one launch (at the old rate, about 7% a re-open, a
  returning freeze shows about three runs in four); TEST_RUNNER_KOSMOS_ANCHORATOPEN=1 runs it against the old open.
  ios/tools/ui-sample.sh: the class count is 3. LogicTests/room: one check pins the #9212 lines.

## Review rounds 3 to 8, and why their code is not here
Each round found real edge cases, and the fixes were built on top (a lapse for the request at 1.9 s, the end naming
"end" whenever the binding is empty, routing the box, keyboard and tray follows through the request, a refused read
dropping the anchor). Measured on the simulator, that code froze again: 0079264007 2 of 2, and 91e39396f0 3 of 4 on the
landing check, where d3aaeb719b had passed 12 of 12. So the shipped change is the measured one, and the edge cases below
go to a follow-up card (kosmos#9226, claimed by monalisa), each to be measured before it is built:
- iOS 17 reports no person's scroll, so a request the end never meets stays set: goNewest only scrolls, and a later end
  appearance names "end".
- goNewest's callers (an arrival, a send, a read that follows the newest) only scroll while the request is set; the box,
  keyboard and tray follows and the delayed put-backs still name "end" directly.
- A refused read drops the list but keeps endSeen and positionId, so the next list can be created anchored.
- Until the end appears no id anchor holds the list, so an earlier page landing above then is not held.

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

## Weakest premise
The simulator, not a phone. And between the open and the end's appearance (a frame or two) no anchor holds the list;
an arrival in that window is followed by goNewest's scroll. The sample board's re-reads bring nothing new, so the
measurements never exercised an arrival during the open.
