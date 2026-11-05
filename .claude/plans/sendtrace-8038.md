# kosmos#8038: a send writes a trace line

## Why
Josh 08:52: after a long message the chat goes blank for a second or two. Angel's #7420 captures cannot say whether a blank came at a send, because a send writes no line in the diagnostic ring. This does not fix the blank; it lets the next capture place one.

## Finished looks like
For the chat on screen, a send puts one line in the ring: its length, how many are pending, atBottom, end visible. Never the words. A drop in the pending count puts one too (a read clearing it, or a delete). A check in the room logic suite pins both.

## Call
Log at the existing pending.count change, which a new send passes through. Rejected: logging in BoardClient, which does not know the list's state.
Not covered, on purpose: a retry flips an existing pending send back to sending and the count does not change, so it writes no line. A capture with no send line therefore does not rule out a retry. "chars" for a files-only send is the length of its file names.
A privacy guard over trace values (LogicTests/room) failed until the two numbers were admitted, by what they are.
Weakest premise: that the 80-line ring still holds the send by the time a report is taken; keyboard and settle lines share it. The trace's timestamps say.
