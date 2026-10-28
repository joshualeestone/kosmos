# pills-7420: reaction rows wrap, so no row can widen the whole chat (kosmos#7420, the shift-left part)

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
