# hideconvmode-5624: hold conversation mode (kosmos#5624)

## Done looks like
On main, no "read new messages aloud" toggle is drawn in a direct message or project room box, and nothing is read
aloud, even for a conversation turned on in an earlier build. The code stays; making CONV_ENABLED default true brings
it back. What's new no longer advertises it.

## Why
Josh 2026-10-09 10:49 "lets hold on the conversation mode", 10:52 "It doesn't make sense to have it in the input
box. Let me think about it." Placement waits for him.

## Decided
- An off-by-default switch, not deleting the buttons: the code and its page check keep working (the check turns the
  switch on via localStorage `kosmos.convmode.enabled`; nothing in the app sets it).
- A stored "on" from 0.7.34 staging stays in localStorage but is ignored while held.
- The 0.7.34 What's new highlight for it is removed on main; the 0.7.34 cut itself is Splinter's, with Josh.
