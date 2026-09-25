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
- Only the words and the display name leave the Mac; attachments do not. The
  words are the text the room STORED (so both rooms show one message), an
  agent's name is the one its project shows (never the tmux session name), and
  a post with no words says in the room that attachments stay here.
- The relay does not echo a post to its poster (kosmos-relay fed-room e2e pins
  it), so a room never shows our own words back as an outside speaker.
- Messages are TLS-protected to the relay, not sealed end to end: #3728.
- `federation_ref` on /api/projects is not screen-gated. It only names a ref this
  board already minted invites under; it grants nothing a process caller could not
  already do by creating a project. The act that admits someone (invite, verify,
  join) is screen-only.
- Bounds on what a peer can make this Mac do: at most 60 kept inbound messages and
  64 KiB per project per minute (then dropped, one room note per minute), which
  keeps a flooding peer under 100 MiB a day in the append-only log; control
  characters removed before storage; 16 KiB per message, matching the
  connector's post limit.
- Anything that stays local says so in the room (a Kosmos note): a post when the
  seat is not up, and a post the relay refused.
- An owner seat refused for good goes back to waiting and picks up another active
  edge, never the refused one again (the coordinator can list an edge as active
  while refusing its ticket, e.g. the owner's own account lapsed); a member seat
  ends. An owner still waiting for a first join asks the coordinator once a
  minute: that is the latency of the first message, kept on purpose.
- While an owner waits for a first join, a post says so ("nobody outside has
  joined this shared project yet"), not "the connection is not up".
- A create with a federation_ref whose owner link cannot be recorded makes no
  project and says so; the link is recorded before any member is told. A removed project's seat is stopped on the next check.
- A join whose link cannot be recorded removes the project it just made.
- Every room post asks whether its room is federated. `federation.linkFor`
  answers from memory while the record's mtime and size are unchanged (a stat,
  not a read and parse), so ordinary rooms pay almost nothing; a damaged file
  is still read and reported, never hidden behind the copy.
- A verified snapshot lasts 30 minutes and at most 32 are held.
- A removed project's link is forgotten along with its seat.
- `from` and `kind` arriving from outside are the other Mac's claim (the relay
  does not attest the poster); the room shows them as an external speaker.

## Verified
- engine/fedseats.test.js (15), engine/messages.external-3311.test.js (5),
  server.fedmsg-3311.test.js (6), server.federation-3311.test.js (8),
  engine/federation.test.js (10): 44 pass.
- Review round 5 controls: passing the owner's name straight through reds the
  name-clash test; passing the owner's description back into create reds it on
  "written into this computer's brief"; counting only posts reds the unread test;
  removing the ended note, or the ended branch in post, reds the ended test.
- Review round 4 controls: putting back `from = delivery.from` reds the unlisted-agent
  test (the session name went out); rethrowing from the recordExternal catch reds the
  cannot-be-saved test; no stdout error listener reds the stream-error test; an edges
  request per project reds the asked-once test (3 asks, not 1).
- Review round 3 controls: removing the display-name lookup, the create
  rollback, the refused-edge memory, the byte budget, or the waiting note each
  reds its own test by name.
- Review round 2 controls: the old `(you.read() || {}).name` lookup reds the
  forwarding test (the operator's name never went out; every post said "the
  project owner"); no cache reds the read-count test; no TTL reds the snapshot
  test; not forgetting the link reds the removed-project test.
- Review round 1 controls: removing the `starting` guard reds the race test (two
  edge lookups); letting an owner's exit 3 end the seat reds the re-pick test;
  lifting the inbound bound reds the flood test; dropping the join rollback reds
  the rollback test; dropping the control-character strip reds its test.
- Controls: dropping `external === true` from the shape rule reds the forged-row
  test; removing the operator-post forward reds the forwarding test on the
  missing output (after the `federated` fix; before it the post never landed,
  which the strict test exposed).

## Decided in round 4
- `federation_ref` stays accepted from a process caller. What that allowed was
  unbounded coordinator polling (one edges request per linked project per minute);
  a check now makes one edges request however many projects are linked, so that is
  closed. A second local project carrying a real ref only puts this same account's
  own Mac in its own room twice. It grants nothing across accounts, because the room
  ticket is still minted per edge by the coordinator.

## Decided in round 5
- A joined project's local name is the owner's name if it can be made here,
  else "<name> (shared)", "(shared 2)"... The owner's description is kept on
  the link record only and is NOT written as the local project's description
  or brief Goal: it is someone else's words and would read as this person's own
  instructions to their agents.
- Not fixed: after an owner edge is refused for good the status is `waiting`
  until the next check even when other members are in, so for up to a minute a
  post can say nobody has joined. Cosmetic and self-correcting.

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
