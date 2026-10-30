# composer-7420: the iPhone chat no longer shifts to the screen edge (TestFlight build 16)

## Finished looks like

- In a DM, the agent's bubbles, their times and the working line keep their 16 pt left margin through a new reply, the composer growing a line, and the keyboard rising (Josh, builds 13 to 15, 10-28 18:53 to 19:04).
- A sideways offset of the chat's list, whatever causes it, is put back to its rest (minus the list's left inset: 0 in portrait) about 0.35 s later, or once the person stops scrolling, and written in the diagnostic's record, once per shift, so a Share from the phone says whether it happened.

## What the evidence says

- Josh's bad shots: every row moved about 16 pt left, his own bubbles and times too (their right margin grew). That is the list scrolled sideways by its side margin, not a wide row (a row wider than the screen would have pushed his bubbles right).
- Simulator, measured (r3): giving the list's scroll view a 16 pt sideways offset (KOSMOS_SAMPLE_SIDEWAYS=5) reproduces his screenshot exactly with the lock off (KOSMOS_SAMPLE_NOLOCK=1, trace "side offset 16 (left)"), and with the lock on the offset is put back and the layout is normal (trace "side offset 16, put back").

## Decided

- Lock the symptom (SideScrollLock: a hidden probe in the list finds its UIScrollView, observes contentOffset, puts x back to its rest on the next turn) rather than chase the cause. The list only scrolls up and down, so there is no legitimate sideways offset to lose.
- Rejected: pinning the stack to the list's width. A row made wider than the screen in the simulator did not widen the lazy stack at all (trace showed no width change), so the premise under the pin was not shown, and the pin would not stop an offset that arrives another way.
- The diagnostic's trace guard now reads ChatView.trace( lines as well as Self.trace(, since the lock writes from outside the view; its two new values are numbers.

- Review 2 (opus): the record no longer gets a line per frame (review 4 finished this: each put-back cleared the once-per-shift flag, so it still could), the Debug offset is given from the rest, and a no-op bounce setting dropped. The only behavioural proof is the simulator run (iPhone 17 simulator, iOS 27.0, KOSMOS_SAMPLE_SIDEWAYS with the NOLOCK control); the source check proves only that the lock is wired, and the "side lock: no scroll view" record line is what a phone would show if the probe ever failed to find the list.

- Review 3 (sonnet): the once-per-shift flag resets when the probe moves window. Not changed: which scroll view the probe finds (nearest UIScrollView ancestor of a view inside the chat's own ScrollView content is that list; an outer container is farther up); putting the offset back can interrupt a fling in progress, but only when the list is already shifted, which is the bug.

- Review 4 (opus): shifts are counted and recorded only at the 1st, 2nd, 4th, 8th... with the count, so a cause that comes back every frame adds a handful of lines, not 80; the put-back waits 0.35 s and is skipped while the list is dragged or flinging, so it cannot cut a scroll in progress short (the next offset change tries again); the watch also reads the offset when it starts; the Debug shift is given once. Not measured: whether 0.35 s outlasts every SwiftUI scroll animation; one still running then would be cut short, as before review 4. The card stays open until a Share from Josh's phone shows the shift gone or put back.

- Review 5 (sonnet): while the list is dragged or flinging the put-back is tried again every 0.35 s (a fling ending with no further offset change left it shifted). Stated plainly: the lock shortens the shift, it does not prevent it; a shift can show for about 0.35 s, or for the length of a scroll the person is making.

- Review 6 (opus): the stack-width trace an earlier session added is gone (unbounded, it could fill the record; the width still reaches the report as before); stale comments say "back to its rest"; a retry from before a window move ends itself. Reading a Share: shift 1 or 2 means the lock caught a shift; shift 8, 16, 32 and up means the lock is fighting whatever keeps causing it (likely the hold on the newest message), which is a visible jump every 0.35 s, NOT fixed, and the next step is the cause.

## Weakest premise

- That the offset on Josh's phone is a UIScrollView contentOffset.x (the mechanism the simulator reproduces) rather than something that looks the same, such as the list's own frame moving. The trace will say: if the phone shifts again with no "side offset" line in a Share, it is the other thing.
- What gives the offset on the phone was not found. The hold on the newest message (scrollPosition, anchor .bottom, centred across) is the likely source.

## Not verified

- Not run on a device.
