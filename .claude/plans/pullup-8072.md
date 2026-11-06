# pullup-8072 (kosmos#8072)

Finished means: on a real iPhone, pulling a chat up past its newest message shows the dots, a new message arrives through it, and nothing blanks or jumps. Merging is not finishing.

The call, with reasons, is on the card. In short: chats only, no inset or offset written, armed only with the end marker showing, keepAtEnd and the anchor untouched.

Rejected: holding space open (an inset change is what blanks the fragile list in the simulator); iOS's refresh control (its own spinner); a SwiftUI state per scroll tick (redraws the chat on every move).

Weakest premises: that dots after the list has bounced back still read as checking; that the dots' spot at the end of the content is visible and not lost in the box's fade (the UI test's screenshot shows it on one simulator).

Not covered: VoiceOver has no action for this, and the chat already reads every 5 s, so nothing is lost. Rooms: later, if chats hold.

The dots' spot: Mona Lisa asked for centred with 16 pt clear of the working line. Measured gap 57 pt gives 16.5 each side, but the box's 18 pt fade then cuts the ring, seen in a screenshot. She chose a whole ring over the 16 pt: 11.5 above, 21.5 below. Measured on: 60 pulls over 12 runs, 0 rebuilds, 10 of those pulls on the fragile opening, no keyboard up, at an earlier spot (the spot does not touch the list). The end-marker gate itself is pinned by a source check, not a behaviour test.
