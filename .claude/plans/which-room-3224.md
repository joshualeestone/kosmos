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
How often that happens is visible in the daily digest: `--new` posts are left out of the suspected-misroute
count and reported on their own counts-only line ("posts confirmed as new after Kosmos asked which room they
were for"). A hold the agent abandons writes no row; the board logs one identifier-free line for each hold.

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

## Review round 1 (opus): no BLOCKER; four SHOULD-FIX, all fixed
- The hold fired on every post for an hour, not once: a `--new` post is now marked `newPost: true` on its
  row, and questions owed at or before the agent's latest `--new` post are not asked about again.
- A question from a room the agent can no longer post in (removed from it, or the room deleted) sent it to a
  refused command: `sendPost` gets `membersOf` from the server and skips such rooms (removed agents via the
  same `_roomMembers` filter the room uses).
- The digest could not tell a deliberate `--new` post from a misroute: `newPost` rows are not counted. A hold
  writes no row; it logs one line with no identifiers ("held a room post to ask which room it meant").
- The hold ran before the text checks: it now runs after them (a post refused anyway gets that refusal) and
  still before the room valve (a misroute never meets the wrong room's loop guard).
- NITs taken: owing the target room exempts only when that question is at least as recent as the newest one
  elsewhere; asks with no id or a non-plain id/project are skipped (the next owed room is used); the Windows
  CLI hands the text back on a hold, and both CLIs say "send again" for it.
- NITs left: the agent instructions (engine/defaults.js) do not mention `--new`, deliberately: an agent learns
  it from the hold's own sentence, and naming it up front invites passing it by reflex. The extra record()
  pass per post is accepted (tail-read cache; same order as the valve pass).
- Mutations added, all RED: no --new acknowledgement, canPostIn ignored, digest counts --new, an older
  target question excuses, newPost not on the row, Windows no hand-back, server drops membersOf. The
  "after the text checks" order is pinned by the oversized-post test (reasoned, not mutated).

## Review round 2 (sonnet): one BLOCKER, fixed
- A post with both `new_post` and `in_reply_to` was marked `newPost`, which acknowledged (and so silenced)
  every question the agent owed anywhere for up to an hour, and both CLIs accepted the combination. The
  reviewer reproduced it end to end. Fixed: the mark is gated on the post not being a reply
  (`newPost && !citedId`, the same gate `askWhichRoom` has, covering the route and the drain), and both CLIs
  refuse `--new` with `--in-reply-to` before sending. Test: a reply with new_post is not marked and a later
  misroute is still held. Mutations RED: server gate removed, bash refusal removed, Windows refusal removed.

## Review round 3 (opus): no BLOCKER; two SHOULD-FIX, fixed
- An `in_reply_to` naming no post (a copied `[q12]` with brackets, a typo) switched the hold off while binding
  nothing: the ask now keys on the citation resolving (`!answeredProject`), not on one being present. The
  `newPost` mark stays gated on `!citedId`, the stricter test.
- The digest went blind to the heuristic (held posts write no row, `--new` posts were skipped): a
  counts-only line for `--new` confirmations now sits beside the misroute line (omitted at zero or when the
  record is unreadable), and the weakest-premise paragraph says what is and is not measured.
- NIT taken: a drained `--new` post is not marked, since the mark would carry the drain time and acknowledge
  questions that arrived after the agent typed `--new`. The live gap (a question landing between the hold
  and the rerun is acknowledged too) is accepted and the comment says so.
- NIT accepted: `projectNameOf` and `membersOf` call `projects.get`, whose `describe` may rewrite
  projects.json. That runs only when an ask is found, the same lookup every other route makes.
- Mutations RED: ask keyed on citedId, drain marks, the digest line never renders, the count counts all posts.
