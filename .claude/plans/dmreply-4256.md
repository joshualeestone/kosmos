# dmreply-4256: Reply in Direct Messages

Card: #4256 (Josh 2026-09-27 17:32: "when will we get message replies ... on projects and direct
messages"). Rooms have had Reply since #3745 (prod 0.6.99); DMs did not.

## Done means

In a Direct Message the person can press Reply on an agent's message, sees "Replying to <agent>:
<first line>" with an x above the box, sends, and the kept reply carries a header naming the message
it answers that jumps to it; the agent is told which message the reply answers. Measured by
render-dm-reply-4256.js (R1 to R8, red on main) and server.test.js "#4256" (red on main's engine).

## Built

- Engine (`engine/messages.js`): `dmAnsweredParts(row, agent)` gives the room's two parts for a DM:
  `tag` inside the operator bracket (" · answers your message, posted 09:30" / "their earlier
  message"), `quote` ('(answering: "first words") ') before the body. The first-words cleaning is
  factored out of `answeredParts` into `answeredWords`, so rooms and DMs quote identically.
  `operatorDirect(nowLabel, answers)` takes the tag.
- Store (`engine/chat.js`): `appendLocked` keeps `replyTo` (a string, only when set). It keeps only
  known fields, so without this the route's `replyTo` was silently dropped.
- Route (`POST /api/agent/:name/thread`): `reply_to` = the answered row's `at` (a DM row has no id;
  reactions key on `at` too). Must be a kept row in this DM with text and not a kosmos/question
  row, else 409 with nothing typed; non-string or '' is 400. A numbered-menu answer (`chose`) is
  never a reply. The quote is dropped (tag kept) if it would push a message at the limit over it.
- Page: Reply in the agent row's bar (`rxnsInner(..., true)`, and `repaintReactions` keeps it for
  `data-at` boxes); `#d-reply` strip reusing `.pj-replying`; `DM_REPLY` per agent like drafts;
  `DM_ROWS` by `at` from every row the thread sent (so a jump can say "hidden by your search");
  header on any row with `replyTo`, "Original message unavailable", or "further back" when the
  thread's 200-row tail left older messages out; jump + flash; x with an already-sending guard;
  keep-inside for the DM agent bar; 36px phone target.

## Decisions

- Reply is offered on the AGENT's messages only. The DM's hover bar exists only there (#3650); the
  room also allows replying to your own post. Adding a bar to the person's rows is a bigger change
  for a rare case. Reversible; recorded on the card.
- Agents answering in a DM (`kosmos reply`) do not get a reply_to here: the card asks that agents
  are TOLD what a reply answers, which is the person-to-agent direction.
- Discoverability (the card asks): Reply is in the hover bar, visible only on hover (or a tap on a
  phone), in rooms and now DMs. Recorded on the card as the likely reason Josh did not find it.

## Weakest premise

Measured in Playwright Chromium only (the new check, and the 14 checks the #2518 surface gate names,
all run on this branch and green, including render-room-reply-3745.js, 44 PASS, on its own sandboxed
board). Not measured in Safari on Josh's Mac. The agent-side wording ("answers your message, posted
09:30") is new copy an agent reads, not the person; it mirrors the room's.
