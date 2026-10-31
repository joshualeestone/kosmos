# reactwrap-7420 (re-landed from pills-7420): reaction rows wrap, so no row can widen the whole chat (kosmos#7420, the shift-left part)

Josh 10-27 20:29: bubbles shifted to the left and touched the screen edge. Not reproduced on the simulator. A lazy stack
takes the width of its widest row and is centred, so ONE row wider than the screen pushes every left-hand bubble off
its 16 pt margin. The one row in the thread that cannot wrap was a message's reactions (one HStack), in the chat and
the room. With #7419 offering 80 reactions, many on one message is plausible.

## Finished looks like
- ChatView's ReactionPills and the room post's reactions use FlowLayout (the app's own, ChatChoices.swift): they
  wrap onto more lines instead of running wider than the screen.

## Decisions
- Weakest premise: this may not be what Josh saw (his messages may have had few reactions). It is a real overflow
  either way, and the #7420 diagnostic (stack width beside the list's width) will say if something else widens it.
- Checked and not the cause: BubbleText caps at a share of the screen and wraps; the only other fixedSize spots are
  the composer's file chip and the search bar's Cancel, both outside the thread.

## Verify
- iOS 16 typecheck; all nine LogicTests scripts (room: both reaction rows wrap, neither is one HStack).

## Review
- Round 1 (sonnet): no blocker; 1 warning fixed: once wrapped, the person's own reactions would start each line at the left under a right-hand bubble; FlowLayout gains trailing (each row flush right), passed as mine in the chat bubble, the files bubble and the room post. Nit accepted: the check is a source guard; on-device sight of a wrapped row is owed. Round 2 below.
- Round 2 (sonnet): no blocker; the shift math, clamping and the unchanged answer-button caller hold. Warning accepted, not fixed: in a right-to-left language the wrapped rows may land on the wrong side. Accepted because the app ships no right-to-left language, the existing answer buttons share the same layout and the same limit, and SwiftUI may already mirror custom layouts (unverified either way); a card for both when a right-to-left language is added. CONVERGED.
- Re-landed 10-29 as reactwrap-7420 (pills-7420 was never merged): its 3 commits cherry-picked onto main, the plan renamed for the gate. Validated on the rebase: all nine LogicTests scripts, the 82 repo tests that read ios/, Debug and Release builds. A Debug sample (KOSMOS_SAMPLE_REACTIONS=many) for the shots; simulator shots light and dark on an iPhone 17e in ~/work/design-shots/kosmos-7420-reactwrap/.
- Round 3 (opus, blind, whole diff): no blocker, no warning. Nit 1 taken: half a point of slack in FlowLayout's wrap test, so bounds rounded a fraction below the widest row never wrap its last item onto a line the height did not count (source-guarded). Nit 2 taken as a comment (FlowLayout needs a finite width). Not taken: a logic test of the layout math (needs arrange moved out of the SwiftUI type; the shots show it), the room block wider than the bubble's cap (as before), right-to-left (round 2). Round 4 below.
- Round 4 (sonnet, blind, the new commit and the whole diff): no blocker, no warning. The slack lets a row measure up to half a point past its bounds; the trailing clamp keeps it from moving left, and the overhang is under two device pixels, accepted. Nits accepted: the source guards are brittle to a rename (wiring guards only, the shots show the layout); ForEach keyed on emoji assumes the board's one pill per emoji, as before. CONVERGED.
