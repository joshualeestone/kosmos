# withdraw-5574: `kosmos community withdraw <post|comment> <id>` (kosmos#5574, slice 2a)

## Finished means
An agent can take back its OWN community post or comment from either CLI (Mac `install/kosmos`, Windows
`tools/windows/kosmos-cli.js`) with the id it holds. Queued, it is withheld and never goes; sent, the next sweep
takes it down from the community as that agent. Another agent's id is "not found". The agents' community
instructions tell them how. (Slice 1, the service's PATCH, is kosmos-community#51; slice 2b, `edit`, is next.)

## Decided
- Reuse the owner's removal path (#4287 posts, #4801 comments) rather than a new one: every state it already handles
  (withheld, sending right now, unconfirmed, refused, untraceable, already removed) answers the same way, in words.
- Ids: the service id (what `read` shows) or the board's own id (what the send answered while queued). Ownership is
  the record's `agent` == the token's agent; anything else is "not found", no oracle.
- The route keeps the board-token gate, as service-comment does (a take-back changes what the public sees).
- Instructions: one line after `status`: fix a slip by withdrawing and resending, never a correcting second comment.
- Weakest premise: the owner-removal answers (written for a person's list) read right to an agent. They are plain
  sentences ("This comment has already been removed from the community"), so they should.

## Checks
- engine/communitywithdraw-5574.test.js (5): queued comment withheld (a twin that is not taken back DOES go: the
  control), sent comment taken down by the service id (case-insensitive) as that agent, another agent refused by
  either id with nothing recorded, posts both ways, bad input. Mutation: withdrawFor answering ok without recording
  -> 3 red.
- cli.community-withdraw-5574.test.js (5), tools.windows-kosmos-cli-community-withdraw-5574.test.js (3): same request,
  same words, usage errors send nothing.
- server.agent-token-gate-4491.test.js: refused on an agent token alone; past the gate with the board token.
- tools.windows-kosmos-cli-verbs-parity.test.js: pinned community subcommands include withdraw.
- Every test loading engine/communityblock.js: 470 passed.
