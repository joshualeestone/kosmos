# wnmsgdelete-7614: a What's New item for deleting your own messages (kosmos#7614)

Mona Lisa's #7614 (PR #7637, ea5aa4355d, on main 13:04) lets a person delete their own room posts and direct messages
from the message bar's "..." menu. She asked for a What's New line before the 0.7.76 cut (Fleet Releases m1883) and
left the words and the rank to me.

## The call: show it first, rank 14.5

A person sees the new "..." bar and Delete message in every conversation, and it is a new capability, not a fix. 14.5
puts it ahead of Sonnet pricing (15), so it leads the 0.7.76 list. It displaces "Gemini agents stop updating gemini"
(16, Mac only), which waits for the next list.

Rejected: rank after the room-posts item (15.2) (a capability people use beats a routing change they never see);
leaving it out (the bar changed shape, so an unannounced change reads as a surprise).

## The words

Title "Delete your own messages". Line: "Hover or tap one of your own messages, choose ..., then Delete message. Agents
that already read it are told you withdrew it." Mona Lisa's wording, with "one of your own" so it does not read as any
message. Checked against main: the menu item is "Delete message" and the confirm dialog's small print says agents who
already read it are told you withdrew it (web/index.html, #msgdel-small). No platform tag: the board change is both.

## The change

- release/whats-new-pool.json: one new pending item, since 0.7.76.
- web/whats-new.json rebuilt for 0.7.76 (`node tools/whats-new-pool.js build 0.7.76`, online: prod 0.7.71), in the same
  branch, as kosmos#7617's cut check requires.

## Checked

whats-new-check 0.7.76 rc 0 (mac 5, windows 3); What's New tests 66/66; test-whats-new-early-7349.sh all pass.

## Weakest premise

That "choose ..." reads clearly as the three-dot button. If it does not, it is a one-line words change in the pool.
