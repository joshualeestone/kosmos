# roomjump-7101: a reply's header goes to the post it answers (a slice 9 gap, #6838)

**Done when:** in an iPhone project room, tapping a reply's header scrolls to the post it answers, centred, flashes
it, and moves VoiceOver's focus to it, as the board's #3745 does; the words and timing are pinned against the board;
it is merged.

## Decisions
- The board's behaviour (web/index.html, the .msg-replyto[data-jump] click handler and .msg-flash): centre the post,
  a gold-deep outline for 1800 ms, focus on the post, no animated scroll for less motion. Pinned against its source.
- The header is a Button with a 44 pt place to tap, laid out as the header alone. VoiceOver reads the post as one
  element (as today), so the jump is that element's action, "Go to the message this answers" (the board's label
  says the same in its "..., the message this answers. Go to it").
- The flash colour is the board's --gold-deep, with --gold-bright in the dark, as a pair local to RoomBubble (the
  app's Palette has no gold).
- The jump is driven from the thread (jumpTo, onChange inside the ScrollViewReader), so a bubble never needs the
  scroll proxy. Each post is an item under its own id (Board.roomItems, tested); only folded Kosmos lines are not,
  and a reply can only answer a post.
- An original not loaded behaves as today (unavailable once the room is complete, nothing before). Not here: loading
  older pages to reach it (the board does not either), and search (#7096, Angel).
- Weakest premise: the scroll, the flash and VoiceOver's landing are unverified on a screen (the simulator shot run is
  not permitted here, #7055). Built on roomattach-7093 (RoomView.swift), so it rebases after #7093 merges.

## Steps
1. View, words, suite, build. DONE: room 234/234 (control: a different flash time is red); Debug build SUCCEEDED.
2. Review loop. 3. Validation, PR (after #7093 merges and this is rebased).
