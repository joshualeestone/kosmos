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
  header shows with the thread on a computer and a tablet, so the on state is in view there and audio does not
  surprise (a card requirement). On a phone a direct conversation's caption row collapses in two cases (see Layout) and the
  toggle with it; the project room's header has no such collapse. It also keeps the message box for writing only, which is what Josh's ruling points at.
- Rejected: an overflow / settings menu (hides the on state, so audio would surprise); Settings > a global switch
  (the card wants it per conversation, and a global switch says nothing about which room is talking); the agent's
  identity column in a direct conversation (not present in a project room, so the two would differ); beside each
  message (that is the existing one-message read-aloud button, a different act).
- Weakest premise: that Josh's objection was to the BOX, not to the toggle being on screen at all. If he wants it
  out of sight, the next move is a menu entry, which is one markup move.
- Moving it again is a markup move of one button per conversation plus check C1; the behaviour code does not depend
  on where the button sits (it is found by class and data-conv-for).

## Layout (challenge iteration 1)
- The room's toggle and search share a wrapper (.pjconvsearch, display: contents), so every existing layout sees the
  search exactly as before. Up to 60rem, where the room header stacks, the wrapper becomes one row once the toggle
  is drawn, so the toggle sits beside the search rather than on a row of its own.
- The toggle goes where the header goes: where a phone collapses a direct conversation's caption row to save room, the toggle collapses
  with it. Two cases:
  - Sideways phone with an idle search: the toggle steps aside, on or off, so the row takes no room in a conversation
    that has 57 to 90 px (the same 44px #3969 refused for the back link; iteration 9 reversed iteration 4's exception
    for an ON toggle).
  - Keyboard up while writing: an existing rule hides the whole row, ON toggle included. Accepted, because the person
    is typing in that very conversation at that moment, and exempting one child would mean rewriting that rule for a
    held feature (iteration 6).
- So the on state is in view wherever the header itself is shown. Before the hold is lifted, decide whether a phone
  needs a separate on-sign for those two collapses (for example on the message box's edge); that is a design call
  for the lift, not this move.
- Accepted (iteration 3): in a direct conversation on a phone under the new look, the caption row wraps and the
  search takes its own line, so the toggle ends the Back row instead of sitting beside the search. It stays in the
  header and in view. The room got a wrapper because its stacked header would otherwise give the toggle a row of
  its own; giving the direct conversation one too would touch a dozen phone rules on that row for a held feature.

## Tests
docs/browser-checks/render-convmode-5624.js C1 now asserts each toggle is in its header row immediately before the
search, and inside no message box. C20 (new) asserts that at 700px the room's toggle sits on the search's line, in both looks (C20b), at 375px (C20c) and at desktop width (C20d).
C21 (new) measures the direct conversation's toggle on its search's line at desktop width, and C21b at 375px in
today's look. All other arms are
unchanged. Not covered by a check: the touch-only rules (the sideways-phone and keyboard-up collapses, and the 44px touch
size), which need a touch-emulating browser context.

## Before the hold is lifted (checklist for whoever turns CONV_ENABLED on)
- Decide whether a phone needs a separate on-sign for the two caption-row collapses.
- Check the touch-only rules on a real phone: the sideways-phone and keyboard-up collapses, and the 44px size.
