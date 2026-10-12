# kosmos#5624: where the read-aloud (conversation mode) toggle lives

## Finished looks like
The Read-new-messages-aloud toggle is no longer in either message box. It sits in each conversation's header row,
directly before the search box: in an agent's direct conversation (`.d-talk-caprow`, beside "Search this
conversation") and in a project room (`.pjmidhead`, beside the room's search). It is still held: CONV_ENABLED stays
off on main, so nothing is drawn or read in the shipped app. The browser check proves the new place with the mode's
switch on (C1), and still proves the held default (C0).

## Decision (Angel, 2026-10-12, night shift; Josh can move it)
Josh's only ruling (2026-10-09 10:52): "It doesn't make sense to have it in the input box." Placement was otherwise
left open. Chosen: the conversation's header row, beside search.
- Why: the mode is a setting OF the conversation (on for this thread), like search, which already lives there; the
  header is visible whenever the thread is, so the on state is always in view and audio never surprises anyone (a
  card requirement). It also keeps the message box for writing only, which is what Josh's ruling points at.
- Rejected: an overflow / settings menu (hides the on state, so audio would surprise); Settings > a global switch
  (the card wants it per conversation, and a global switch says nothing about which room is talking); the agent's
  identity column in a direct conversation (not present in a project room, so the two would differ); beside each
  message (that is the existing one-message read-aloud button, a different act).
- Weakest premise: that Josh's objection was to the BOX, not to the toggle being on screen at all. If he wants it
  out of sight, the next move is a menu entry, which is one markup move.
- Moving it again is a markup move of one button per conversation plus check C1; the behaviour code does not depend
  on where the button sits (it is found by class and data-conv-for).

## Tests
docs/browser-checks/render-convmode-5624.js C1 now asserts each toggle is in its header row immediately before the
search, and inside no message box. All other arms are unchanged.
