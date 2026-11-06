# pullup-8072 (kosmos#8072)

Finished means: on a real iPhone, pulling a chat up past its newest message shows the dots, a new message arrives through it, and nothing blanks or jumps. Merging is not finishing.

The call, with reasons, is on the card. In short: chats only, no inset or offset written, armed only with the end marker showing, keepAtEnd and the anchor untouched.

Rejected: holding space open (an inset change is what blanks the fragile list in the simulator); iOS's refresh control (its own spinner); a SwiftUI state per scroll tick (redraws the chat on every move).

Weakest premises: that dots after the list has bounced back still read as checking; that the dots' spot at the end of the content is visible and not lost in the box's fade (the UI test's screenshot shows it on one simulator).

Not covered: VoiceOver has no action for this, and the chat already reads every 5 s, so nothing is lost. Rooms: later, if chats hold.
