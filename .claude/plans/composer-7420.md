# composer-7420: the iPhone chat no longer shifts to the screen edge (TestFlight build 16)

## Finished looks like

- In a DM, the agent's bubbles, their times and the working line keep their 16 pt left margin through a new reply, the composer growing a line, and the keyboard rising (Josh, builds 13 to 15, 10-28 18:53 to 19:04).
- A sideways offset of the chat's list, whatever causes it, is put back to its rest (minus the list's left inset: 0 in portrait) at once and written in the diagnostic's record, once per shift, so a Share from the phone says whether it happened.

## What the evidence says

- Josh's bad shots: every row moved about 16 pt left, his own bubbles and times too (their right margin grew). That is the list scrolled sideways by its side margin, not a wide row (a row wider than the screen would have pushed his bubbles right).
- Simulator, measured (r3): giving the list's scroll view a 16 pt sideways offset (KOSMOS_SAMPLE_SIDEWAYS=5) reproduces his screenshot exactly with the lock off (KOSMOS_SAMPLE_NOLOCK=1, trace "side offset 16 (left)"), and with the lock on the offset is put back and the layout is normal (trace "side offset 16, put back").

## Decided

- Lock the symptom (SideScrollLock: a hidden probe in the list finds its UIScrollView, observes contentOffset, puts x back to its rest on the next turn) rather than chase the cause. The list only scrolls up and down, so there is no legitimate sideways offset to lose.
- Rejected: pinning the stack to the list's width. A row made wider than the screen in the simulator did not widen the lazy stack at all (trace showed no width change), so the premise under the pin was not shown, and the pin would not stop an offset that arrives another way.
- The diagnostic's trace guard now reads ChatView.trace( lines as well as Self.trace(, since the lock writes from outside the view; its two new values are numbers.

- Review 2 (opus): one record line per shift (a cause that re-applies every frame cannot flood the 80-line record), the Debug offset is given from the rest, and a no-op bounce setting dropped. The only behavioural proof is the simulator run (iPhone 17 simulator, iOS 27.0, KOSMOS_SAMPLE_SIDEWAYS with the NOLOCK control); the source check proves only that the lock is wired, and the "side lock: no scroll view" record line is what a phone would show if the probe ever failed to find the list.

## Weakest premise

- That the offset on Josh's phone is a UIScrollView contentOffset.x (the mechanism the simulator reproduces) rather than something that looks the same, such as the list's own frame moving. The trace will say: if the phone shifts again with no "side offset" line in a Share, it is the other thing.
- What gives the offset on the phone was not found. The hold on the newest message (scrollPosition, anchor .bottom, centred across) is the likely source.

## Not verified

- Not run on a device.
