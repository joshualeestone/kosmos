# fed-msg-3311: messages in a federated project's room

## Why
#3311 (Josh 2026-09-25 07:05). With invite/join on the board (fed-board-3311)
and the connector's `fed-room` seat (kosmos-relay fed-room-3311), nothing on the
board yet carried messages between a federated project's room and its seat.

## Change
- `engine/fedseats.js`: one `kosmos-tunnel fed-room` child per linked project
  (`remote.spawnFedSeat`). Member seat: the link's edge. Owner seat: an active
  edge of its project_ref, from the Mac-signed `edges` route; none yet means
  "waiting", retried every 60 s (nothing tells the owner's board a join
  happened). Exit 3 = refused for good (no restart); other exits and spawn
  errors restart with 2 s to 60 s backoff. No seat on a Mac not enrolled.
- `messages.externalPost` + an `external` row kind (shape rule requires
  `external: true`, a person/agent kind, a non-blank sender), bounded sizes.
- `server.js`: seats taken at listen and after a join or a linked create; the
  room route returns external rows and `kosmos room` prints them as
  `[external agent|person] Name: text`; a post that LANDS in a federated room
  (operator or agent) is sent out through its seat (`federateOut`).
- `messages.sendPost` `federated` flag: the operator may post into a federated
  project with no local agents (the second party is outside), where it was
  refused as "nobody is on that project yet".
- Page: `.msg.ext` bubble with the sender's name and an External / External
  agent tag, initials avatar, plain escaped text.

## Decided
- Agents are NOT typed into when an external message arrives. They read it in
  the room, tagged external, as someone else's words (Josh's guardrail: a
  connected peer can never command our computer or agents).
- Only the words and the display name leave the Mac; attachments do not.
- Messages are TLS-protected to the relay, not sealed end to end: #3728.

## Verified
- engine/fedseats.test.js (5), engine/messages.external-3311.test.js (4),
  server.fedmsg-3311.test.js (2), plus fed-board's 13: 24 pass.
- Controls: dropping `external === true` from the shape rule reds the forged-row
  test; removing the operator-post forward reds the forwarding test on the
  missing output (after the `federated` fix; before it the post never landed,
  which the strict test exposed).

## Not yet
- The live two-Mac proof. (The browser check exists: render-fed-external-3311.)

## Surface gate (#2518)
The external row reuses the room's `.msg` / `.msg-b` / `.msg-bd` classes, which
render-dm-phone-718 and render-agentdm-3414 assert on. The new markup renders only
for `kind: 'external'` rows in a project room and changes no existing rule for
those classes; both checks pass on this branch (run through tools/browser-checks.sh).
The commit carries a Browser-check-surface trailer for each, naming the check
with its `.js` (the gate matches the file name; a first attempt without it did
not count).
