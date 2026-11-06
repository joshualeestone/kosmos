# blankring-8053: a ring while a chat has drawn nothing (kosmos#8053)

Finished means: Josh sees the ring during a real blank on his phone, or stops seeing blanks; a normal open never shows it.

Calls are on the card. The dots (Josh 11-05 18:33: dots only in the mobile app) and "Loading the conversation..." after 1 s with messages and none drawn (0.6 was too near the slowest
normal open in the 11-05 captures, 0.76 s). Gone at the first row. At 10 s it stops and says the conversation did not load,
with Try again, which resets the rebuild budget and rebuilds. It reads state and writes none, so #7420's checks and the diagnostic
line behave as before. Two trace lines, so a capture records it.

Weakest premise: that 1 s separates a normal open from a blank on his phone. A simulator cannot blank on demand, so the two states are
forced in the UI test and only a normal open is measured for real.

Built as a poll, four times a second from the ring, because reading the row set in the screen's body would redraw the whole list on every row that scrolls. Only time with the app in front counts. UI checks run its real timing with the blank held back (KOSMOS_SAMPLE_BLANKRING=<seconds>). A real blank stays unseen.

Try again is the one write, on the person's tap: it resets the rebuild budget and forces a rebuild. Limits, stated. UI checks hold the blank answer true; nothing walks the real isBlank closures to true, since nothing can blank on demand, so that wiring is read, not run. "Drawn" means rows SwiftUI said appeared, as #7420's checks read it, so a blank with rows said to appear shows no dots. Costs accepted: in a room on iOS 16 and 17 a scroll through an undrawn stretch can show the dots, since its scroll signal is iOS 18 and later; the room's and chat's counts read different sources (thread rows, shown items), the same set with no search.
