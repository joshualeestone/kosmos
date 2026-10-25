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
- The flash colour is the board's --gold-deep in both themes, as the board draws it (local to RoomBubble: the app's
  Palette has no gold); no fade under Reduce Motion, as the board's transition: none.
- The header reads the board's label to VoiceOver (Board.replyJumpLabel, "<who>: <gist>, the message this answers.
  Go to it") as words in the post, through accessibilityRepresentation, so the jump stays one action on the post
  rather than a second button competing for the double-tap. On a reply, that double-tap IS the jump, as the label
  says (review 2); the agent's chat the avatar gave it stays as a named action. Other posts keep their double-tap.
  The header has a real 44 pt minimum height (a hit area hung past it overlapped the words below).
- The gist is Board.replyGist, the board's pjReplyGist through the chat's own ports: the first line cut to 80
  (replyWords), an agent's own leading "Name:" dropped (dropSelfName, never for the person's or an outside post),
  a files-only post's first file, else "a message". The flash colour is Board.replyFlashHex, pinned.
- VoiceOver's focus moves after the scroll (a lazy row far up does not exist until then), cleared first so a repeat
  jump still moves it. A page of older posts loading while the post flashes keeps it centred.
- The header names only a post or an outside message; a Kosmos line is never an original.
- The jump is driven from the thread (jumpTo, onChange inside the ScrollViewReader), so a bubble never needs the
  scroll proxy. Each post is an item under its own id (Board.roomItems, tested); only folded Kosmos lines are not,
  and a reply can only answer a post.
- An original not loaded behaves as today (unavailable once the room is complete, nothing before). Not here: loading
  older pages to reach it (the board does not either), and search (#7096, Angel).
- Weakest premise: the scroll, the flash and VoiceOver's landing are unverified on a screen (the simulator shot run is
  not permitted here, #7055). Built on roomattach-7093 (RoomView.swift), so it rebases after #7093 merges.

## Steps
1. View, words, suite, build. DONE: room 234/234 (control: a different flash time is red); Debug build SUCCEEDED.
2. Review loop.
   - Round 1: 0 blockers, 4 warnings, 4 nits. Fixed: a 44 pt target; the board's label through
     accessibilityRepresentation (no competing button); focus after the scroll, cleared first; older pages keep the
     flashing post centred; --gold-deep in both themes; no fade with Reduce Motion; a Kosmos line is never an
     original; the board-only centring check named as a premise. Room 235/235; Debug SUCCEEDED.
   - Round 2: 0 blockers, 2 warnings, 3 nits. Fixed: the reply's double-tap is the jump (a modifier, only on
     replies), with "Open <name>'s chat" kept as an action; a real 44 pt minimum height; Board.replyGist with the
     board's fallbacks (tested); the item-id test covers outside messages; the gold pinned to --gold-deep.
     Room 240/240; Debug SUCCEEDED.
   - Round 3: 0 blockers, 2 warnings, 4 nits (2 measured survivors). Fixed: the gist through replyWords and
     dropSelfName (the plan's reason for skipping the name was wrong: the board drops it because the header names
     the sender); the action's whole words checked; the "a file" fallback tested; the gold from Board.replyFlashHex.
     Recorded: the default-action modifier's identity flip when an original arrives on an older page (rare); a
     possible duplicate "Open <name>'s chat" in VoiceOver's actions joins the real-iPhone list. Room 244/244
     (control: no name drop is red); Debug SUCCEEDED.
   - Round 4: 0 blockers, 2 warnings (both measured survivors), 1 nit. Fixed: the person's-post guard tested with
     "You: ..." (it could not fail before), the outside-message guard tested; a repeat jump restarts the flash (a
     token, only the latest timer clears it).
3. Validation, PR (after #7093 merges and this is rebased).
