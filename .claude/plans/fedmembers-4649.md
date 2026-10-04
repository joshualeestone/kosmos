# #4649 slice 1: the owner's outside invites, Members, Remove, Withdraw (board side)

The build plan is on #4649 (comment 5982094423), and the board API contract is the card's comment 5982467325, corrected in
5982498731: an existing project is invited by its id (`project`), not by a ref the page cannot know. Mona Lisa's design
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
2. (Corrected in review round 3; my first wording was false.) An invite made on the CREATE screen is never recorded
   here: the project does not exist yet, so there is no id to file it under. That holds after this change too, not
   only for older invites. Members therefore also lists every connection on the project's ref that has no row, as
   joined or removed with no label, so anyone in the room can be seen and removed. A create-screen code nobody has
   used yet is not listed (the coordinator lists no unused invite) and cannot be withdrawn from here; it lapses.
3. Remove relies on the owner's next room check to rotate the key (up to the 60 s pass, #5191's window).

## Review round 1 (opus): 3 blockers, all fixed with a test that reds when the fix is removed
- The new owner link was stamped with the INVITE time; fedseats.stampOf compares it with the project's createdAt, so
  the seat check forgot the link within 60 s and the guest joined a room nobody sat in. Now stamped with the
  project's createdAt (the create path's rule); the server test asserts fedseats.linkFor accepts it.
- A link left by an earlier project of the same id (#3851) was reused, so a new guest joined the OLD room. Now
  forgotten first, with its room keys and invite rows, as the own-code route does.
- Two invites at once on a never-shared project minted two refs. Invites for one project now run one at a time.
- Also: the seat starts at once after an invite from an existing project (ensure); removing a project forgets its
  invite rows (and the create path does, for a reused id); Members answers 404 for a project not on this board;
  Withdraw keys on the coordinator's own sentences (slice 2: "already been used", "already withdrawn", "no such
  invite") and on the connector's "does not sign" / a bare HTTP 404 for an older connector or coordinator.

## Review round 3 (opus): 2 warnings, fixed
- Create-screen joiners were invisible and unremovable (above, premise 2). Fixed and tested.
- made_at and withdrawn_at were milliseconds while expires_at is seconds. All stored times are seconds now.
- Also: the room line on Remove is written by the board (the contract said so; the plan had said the screen),
  worded by whether the room is sealed; the description sent is the project's on this board, like the name.

## Tests
engine/fedmembers.test.js (10), server.fedmembers-4649.test.js (4), engine/federation.test.js and
server.federation-3311.test.js: 63/63. Mutations, each red on its own test: Remove without the project check; the
label sent to the coordinator; Members without the screen gate; the invite-time stamp; no stale-link forget; no
per-project serialization; no forget on project removal.
