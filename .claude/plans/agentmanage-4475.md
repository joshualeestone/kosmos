# agentmanage-4475: step 3 of #4475, the board enforces "remove only an agent you created"

Card: kosmos#4475. Stacked on boardkeychain-4491 (#4491, the board token out of a token-only agent's reach), per
Splinter 2026-10-02 17:06: one full run of this branch (the stack's top) validates both; they merge in order.

## Done looks like
On an enforcing board, an agent that presents only its own agent token can remove an agent it created and no other,
and cannot force a removal; the person (the board token) removes any agent exactly as before.

## Change
- `server.js`:
  - `AGENT_TOKEN_ROUTE_PATTERNS` gains `DELETE /api/agent/<name>/removal`, so a token-only agent reaches the route.
    Planning a removal (GET), restore and every other agent route stay behind the board token.
  - The DELETE handler asks `agentTokenOnlyCaller(req)`. For a caller that came through on its token alone: the target
    must be named by its board name (the slug), else 400, because the check matches by slug and the engine acts on the
    name as sent; `?force` (the person's override) is refused; and any target `tokenOnlyMayRemove` does not allow is
    refused (403, in step 1's doctrine words). A caller holding the board token (the person, the page, every
    non-token-only agent) is untouched.
  - `tokenOnlyMayRemove` allows only when the target's newest birth (`agentBirthOf`: `created` or `partial`, newest
    line wins) is `created`, carries `createdByName` equal to the caller's token name exactly, a time and the time
    the creator asked (`askedAt`); and neither identity has ended since (`sendertoken.endedSince`): the target after
    its birth (strictly, since its own creation revokes its name just before the birth is written), the creator at or
    after it asked. A key-only or twin token is refused, and so is a name a token already stood for when it was made
    (`tookTokens`).
  - POST /api/team stamps `askedAt` when the request arrives and, on the agent path, reads the caller's exact token
    name; it passes both to the team.
- `engine/sendertoken.js`: a history of ended identities, `ended-agents.jsonl` (append-only: name and time), written
  by `revoke` (`noteEnded`, before the unlink, so a failed revoke still records it) and read by `endedSince(names,
  since, { inclusive })` (slug match, loose on purpose since a match refuses; null when unreadable).
- `engine/create.js` records `tookTokens` on a birth when a token stood for the name as create was asked
  (`sendertoken.holdsTokens`), before create's own revoke clears it.
- `engine/team.js` sets `createdByName` and `askedAt` on every member: the asking agent's token name and its request
  time when an agent (not the setup guide) asked on a named token, else null, so a member cannot set them.
  `engine/create.js` records them on the birth.
- Tests: `server.agent-remove-4475.test.js` (28); `engine/remove.test.js` (a real removal ends the identity in the
  history and a restore does not erase it); `engine/delete-leftover.test.js` (deleting a stopped, never-removed
  agent's leftovers ends it too); `server.team-agent-token-1279.test.js` (the agent path records the exact token name
  and askedAt for a creator whose sessionName differs; the board-token path records none; END TO END: an agent makes
  a member through POST /api/team, removes it with only its own token, and once its identity ends a later agent of
  its name is refused); `engine/team.newrole-4474.test.js`
  (createdByName sorted as a field the team sets, and who gets one); the pins in `server.agent-token-gate-4491.test.js`
  and `server.agent-token-sender-570.test.js` (the route list, and the token-only call-site count now 3).

## Decisions
- Scope, stated as the card's spike did: real enforcement only for a TOKEN-ONLY agent, which cannot present the
  board token (#4491 keeps it unreadable, slice 9 stops it sending one). An agent that can still read the board
  token is indistinguishable from the person, so for it this stays advisory (step 1's doctrine). It widens as
  token-only becomes the default.
- The creator is matched by its EXACT token name, recorded on the birth (`createdByName`). `createdBy` is not used:
  it is the card's sessionName, a slug with a pane and a lossy store key without one, so any comparison with it is
  either too loose (dr-kip and drkip) or too strict (an adopted "Casey"). Reviews 2 and 3.
- The person's paths record no `createdByName`. They do record fixed creator words ("operator" from the org-chart
  import, "kosmos" for the setup guide) in `createdBy`, and an agent can take either as its name; without this rule
  an agent named "operator" could remove everything the person imported (review 1).
- The setup guide's creations are the person's: it makes agents on the person's behalf, so its births carry no name
  and it cannot remove them. Rejected: letting it, as any other creator.
- **Ownership ends the first time the target's or the creator's identity ends after the birth** (reviews 7 and 9).
  It is recorded in `sendertoken.revoke`, because every path that ends an agent revokes it first: removing it,
  deleting what is left of it (#514, which also frees a stopped agent that was never removed, review 9), and
  creating an agent of the name (create revokes a name before making it). A later agent under either name, however
  it arrives (made, adopted, a remote token), is then never the one the birth is about. Rejected: the profile id
  (reviews 5 and 6), which survives removal and is carried to a new agent of the same name, so it did not tell
  incarnations apart; its tests deleted the profile by hand and so assumed what they tested. Rejected: a removal-only
  history (review 7's fix), which missed a name freed by deleting a stopped agent's leftovers.
- A live remote agent holds no folder, job or pane, so create can take its name and its revoke clears that agent's
  tokens (a pre-existing gap in create, review 11). This change would have turned that into a removal of the remote
  agent's name; `tookTokens` refuses it. Rejected for this card: making create refuse such a name, a change to
  create's own behaviour that belongs on its own card.
- A remote token the person issues again under a name (POST /api/agent-token) mints without revoking, so it carries
  that name's identity on: a remote creator re-issued its name keeps what it made. That is the person's act and is
  taken as the same identity.
- The creator is checked from when it asked (`askedAt`, stamped as the request arrives), not from the birth, which is
  written after the create returns: a creator removed while its request ran is caught (review 9).
- Ownership does not come back on restore: the history is not erased by it. The person can remove a restored agent.
- A newer `partial` birth of the name ends the older agent-made one's ownership; a `partial` creation is never
  removable by its creator. Agents made before this change (no `createdByName`), and creators whose token carries no
  name (before #4792), cannot remove; the person can.
- A history that cannot be read refuses. A failed append is logged; it is caught by nothing else, so the residual is
  an agent ended on a full disk.
- Accepted premise: the wall clock orders an end after the birth it ends (both are ISO times from it). A backward
  clock step between the two, and a name reused inside that window, would keep ownership. Rejected: a shared sequence
  number across the birth log and the removal history, more machinery than that window warrants.
- Rejected: refusing every agent-token removal (today's behaviour): it keeps "PM, build me a team" from tidying up
  its own team, which #1279 made possible; and a general permission grid now (no asked-for need beyond this boundary).
- Not done: a `kosmos` verb for removal. The doctrine tells agents to use a command or ask the person; with no verb,
  the person still removes from the board. A verb is a follow-up if a PM agent needs it.
- Not bounded: `ended-agents.jsonl` is append-only, written on creates and removals only (not restarts), and read
  whole on each token-only removal. Low volume today; a follow-up if it grows.
- Weakest premise: that every way an agent's identity ends goes through `sendertoken.revoke`. True for removal,
  deleting what is left, and create (the token module's own header requires it of any caller that recreates or
  deletes an agent). A person deleting an agent's files by hand outside Kosmos, then adopting a new agent of that
  name (adopt mints without revoking), is not seen.

## Validation
- `server.agent-remove-4475.test.js` 29/29, `server.team-agent-token-1279.test.js` 23/23, `engine/remove.test.js` 93/93,
  `engine/delete-leftover.test.js` 15/15, `engine/team.newrole-4474.test.js` 22/22,
  `server.agent-token-gate-4491.test.js` 25/25, `server.agent-token-sender-570.test.js` 7/7.
- Mutants, each failing only its own cases: revoke not writing the history (the delete-leftover and end-to-end tests),
  the creator checked from the birth instead of askedAt, the target check removed, the creator check removed, an
  unreadable history read as none, the target's end counted at the birth's exact time, the removal route ignoring
  `tookTokens`, create not recording it, plus (re-run on this code at
  b54ebe022) the createdByName presence check, the key-only refusal, the board-name check, a slug comparison of the
  creator, and the team route recording the sessionName in place of the token name.
