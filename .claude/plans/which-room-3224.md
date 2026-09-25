# which-room-3224: ask which room a non-reply post meant

Card: kosmos#3224 (Josh 2026-09-17: an agent on several projects sometimes posts into the wrong project's
room). The reply half shipped in #3567: a post with `--in-reply-to` is bound to the room of the message it
answers. This branch is the proactive half, a post with no citation. Decision recorded on the card
(14:20 CDT 2026-09-25, Splinter's routing, Josh can override).

## The rule
A live `POST /api/post` with no `in_reply_to` and no `new_post: true` is held once, with a question, when the
posting agent owes the person an answer in a different room:
- an operator post in project B that mentioned the agent and reached its pane (anything but could_not),
  with no room post from the agent in B since (the #185 "owed" test);
- under an hour old (`WHICH_ROOM_WINDOW_MS`);
- and nothing is owed in the target room A (owing both makes a post to A ordinary).

The answer is `{ state: 'could_not', code: 'which_room', because }`, naming B (by name, id fallback), the
question's id, and both commands: `kosmos post --in-reply-to <q> <B> ...` and `kosmos post --new <A> ...`.

## Where
- `engine/messages.js`: `owedElsewhere(agent, targetProject, now)`; `sendPost` takes `askWhichRoom` and
  `projectNameOf`, and holds after the membership check. The hold does NOT go through `refuse()`, which
  logs a refused row the room shows; this is a question to the agent.
- `server.js`: `new_post` is a strict boolean (400 otherwise); the route asks unless `new_post` is true;
  `sendRoomPostAsAgent` never asks for a reply (in_reply_to set). The outbox drain never asks: the agent
  that kept the post is not there to answer, so the drain would retry forever.
- `install/kosmos` and `tools/windows/kosmos-cli.js`: leading `--new` flag, usage lines updated together.
- The `because` has no double quotes or backticks: the bash CLI reads it with a sed that stops at a quote.

## Rejected
- Refuse outright on any mismatch: no oracle for where the agent is; multi-room agents post to many rooms.
- Post and warn afterwards: the wrong message would already be in the wrong room.
- Silent redirect to B: wrong whenever the post really was new, and surprising either way.
- Holding kept posts in the drain (see above).

## Weakest premise
The owed heuristic. An agent owing B that posts something unrelated into A within the hour pays one rerun.
The daily digest's suspected-misroute count (#3231) is the measure of how often the condition is true.

## Verification
- engine/messages.which-room-3224.test.js (14): found, control, answered, same-ms, a post to A does not
  answer B, same room, owes both, the window (61 vs 59 min), could_not, someone else's ask, future ask,
  most recent named, agent named "you", unreadable record.
- server.post-whichroom-3224.test.js (8): the hold (control first; names B, id, both commands; no quote or
  backtick; nothing in the record; no refused row), --new, answering clears it, a reply is never asked,
  same room, old ask, new_post type check, the drain never holds.
- cli.post-new-3224.test.js (4) and a Windows CLI parity test.
- Mutations, all RED: route never asks, --new ignored, reply also asked, drain asks, no window, no owes-target
  exemption, hold via refuse(), bash CLI drops new_post, Windows CLI drops new_post.
