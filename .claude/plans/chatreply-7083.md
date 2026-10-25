# chatreply-7083: reply to a message and react to it in the native chat

Card: kosmos#7083, item 3 of the gap list on #7074 (a gap in #6838). The native room replies and reacts; the native chat
with one agent did neither, though the board's chat does both.

## Finished looks like
On main, in the native chat: a long-press on one of the agent's messages offers 👍 ❤️ 🔥 and Reply (as the native
room's menu, and the board's DM hover bar, which offers Reply on the agent's messages); reactions show as pills under
the agent's message, the person's own marked, and a tap on a pill toggles it; Reply puts "Replying to <name>: <gist>"
with an x above the composer, and Send carries `reply_to` (the message's `at`); a message that answers another shows a
header naming who and what it answers, or "Original message is further back" / "Original message unavailable" (the
board's dmReplyHead). Refusals say the Mac's sentence on the composer line. Checked by ios/LogicTests with broken-copy
controls, server.ios-routes-6838.test.js (the react request is read in place), and simulator shots.

## The board it follows (web/index.html, server.js, engine/chat.js)
- Send: POST /api/agent/<name>/thread `{text, reply_to}`; a stale or foreign reply_to is refused, nothing sent (#4256).
- React: POST /api/agent/<name>/thread/react `{at, emoji}` toggles; answers `{ok, op, emoji, at, reactions}` (pills
  `{emoji, count, who, mine}`) or `{ok:false, because}` (chat.reactDirect: only the agent's own messages).
- Thread rows carry `replyTo` (an `at`) and `reactions` (pills).
- dmReplyHead, pjReplyGist, replyHeardLine; the DM's reply strip.

## Decided
- Reactions: the native room's three (👍 ❤️ 🔥) plus toggling any pill already on the message; the board's full picker
  stays on the board.
- Reply and react only on the agent's messages (the board's hover bar; the Mac refuses a reaction on the person's own).
- The pending reply is per open chat (not kept across leaving the chat); the board keeps one per agent.
- A reaction answer repaints that one row from its pills, as the room does; the next read confirms.
- The reply header is plain text; the board's is a button that jumps to the original. Deferred: scrolling to a row
  (and loading earlier pages to reach it) is its own piece of work.
- `ChatReaction` lives in BoardLogic.swift (the room's Board.Reaction shape) because BoardRoom.swift is not compiled by
  every suite that compiles the chat.

## Weakest premise
That the three reactions are enough on the phone. The board offers a full picker; a reaction made there shows here as a
pill and can be toggled off.
