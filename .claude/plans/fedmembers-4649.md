# #4649 slice 1: the owner's outside invites, Members, Remove, Withdraw (board side)

The build plan is on #4649 (comment 5982094423), and the board API contract is the card's comment 5982467325, corrected in
5982xxxx: an existing project is invited by its id (`project`), not by a ref the page cannot know. Mona Lisa's design
(shots 1 to 11) is the card's comment from 2026-10-04 16:17 UTC. The screens are Pete's; this is the board API they call.

## Call
- **Invite from an existing project.** `POST /api/federation/invite` accepts `project` (an id). The board uses the
  project's owner link ref. A project never shared gets a new ref, and its owner link is recorded ONLY after the
  coordinator made the invite, so a refused invite leaves the project exactly as it was. A `member` link (a project
  this board joined) is refused as `not-owner`; a `self` link as `self-shared` (unchanged, #4658). The response
  carries `invite_id`. The create screen's `project_ref` path is unchanged.
- **The owner's invite record** (engine/fedmembers.js, `fed-invites.json`): invite id, kind, the owner's label,
  made_at, expires_at, withdrawn_at. No secrets: an invite's sealing half stays in fedseal and is spent when a member
  joins, which is why this is a separate file. The label never leaves this computer (the coordinator keeps no names,
  by design). At most 64 rows per project. Damaged record: never overwritten, the code still works and says
  `recorded: false`.
- **Members** joins that record with the coordinator's `as_owner` edges for this project's ref, by invite id:
  joined (active edge), removed (any other edge status), withdrawn, expired, pending; newest first. When the
  coordinator cannot be asked the rows still come back with `checked_at: null`.
- **Remove** checks the edge is THIS project's (from the edges list) before revoking; the owner's next room check
  rotates the key (#3728/#5191: revokeCheck). The room line on removal is the screen's (Pete), not here.
- **Withdraw** calls the coordinator's `POST /v1/mac/federation/invite/withdraw` (slice 2, relay). A coordinator
  without it (404) answers `unsupported`; a redeemed invite answers `joined`.

## Rejected
- Listing invites from the coordinator: it would have to store names; it stores none by design.
- Reusing fedseal's pending invites as the Members record: they hold secrets and are deleted when a member joins.
- Recording the owner link before the invite: a refused invite would leave a never-shared project half-shared.

## Weakest premises
1. A member's edge row carries the same `invite_id` the owner's invite returned (coordinator fed.rs: every edge
   redeemed from an invite carries its id, #3728). True on relay main; if a later coordinator drops it, every row
   reads `pending` forever.
2. A project shared with outsiders before this change has no rows (invites from the create screen were not
   recorded): its Members list is empty until a new invite. Accepted; the joined edges are still listed by the
   coordinator for the room itself.
3. Remove relies on the owner's next room check to rotate the key (up to the 60 s pass, #5191's window).

## Tests
engine/fedmembers.test.js (8) and server.fedmembers-4649.test.js (2), plus federation.test.js and
server.federation-3311.test.js: 32/32. Mutations, each red on its own test: Remove without the project check;
the label sent to the coordinator; Members without the screen gate.
