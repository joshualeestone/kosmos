# starclaim-8708: iPhone star burst follow-ups (items 1 and 2 of #8708)

Card: kosmos#8708, left at the 8-round review cap of #8706 (PR #8713). Stacked on iphonestar-8706 until it merges.

## Finished means
A star view rebuilt while its burst is waiting (the 0.25 s swipe or 0.35 s menu wait) still plays the burst, once; a
press that has started never plays again in that place; Reduce Motion is read once, when play is asked. Proven by logic
tests that run the shared ledger, each shown able to fail.

## Changes
- StarBurstsPlayed moves to BoardClient.swift (UIKit-free, so LogicTests compile and run it). schedule(id, place, by:)
  lets the latest view own a press that has not started; start(id, place, by:) starts it only for its owner, once.
- StarredStar.play schedules with its own token, waits only what is left of the press's wait, and starts through the
  ledger. The late `!reduceMotion` read from a copied view is gone (item 2). Under Reduce Motion a view still schedules (takes
  the press over) and then plays nothing, so a view rebuilt with Reduce Motion on stops the one it replaced (Sonnet review 2).
- StarBurst.remaining(now:) is the wait left for a view that schedules late (tested, clamped to 0).
- The owner list keeps the newest 16, as the started list does: a press re-starred during its wait is never started and
  its owner would otherwise stay.
- StarBurst.fresh counts from when the burst is due (at + delay), so a view rebuilt during the wait can still take it.
  This also lets a star in the OTHER place (the chat header) begin its first play up to delay + 0.3 s after the press,
  not only a rebuilt row (Opus review 3). Harmless on a phone, where the list and a chat's header are not on screen
  together; stated so it is not a surprise.
- starBurstWindow is nonisolated, so StarBurst.fresh reads it without crossing the main actor (a Swift 6 error).
- Tests: five ledger checks (rebuild takes over, the replaced view does not start, once only, places independent) and
  a freshness check with a wait. Removing the owner check fails two of them (measured).

## Rejected
- Claim only at start with no owner: the replaced view's pending block (a struct copy) would still start it, off screen,
  and the visible rebuild would be refused, which is the defect.
- Clearing on onDisappear: whether a disappeared view's @State is still written is not something to rely on.

## Weakest premise
That a rebuilt StarredStar gets a new `token` (fresh @State) while the old view's pending block still holds the old one.
That is how SwiftUI identity works for a re-created view; not seen on a device.
Second, and not handled: two copies alive at once (iOS 16 can build a toolbar item more than once, a measured or
overflow copy beside the shown one). If a hidden copy appears after the shown one, it owns the press and the header
plays nothing visible. Owed on #8708's device check: the header burst seen on a device (Opus review 1).

## Not in this change (still on #8708)
Items 3 to 7: device checks of the waits, resuming a burst part-way, the toolbar hit test, the row's reach, the 1.9:1 note.
