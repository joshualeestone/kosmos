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
    line wins) is `created`, carries `createdByName` equal to the caller's token name exactly, and carries a time; and
    neither the target nor the creator has been removed since that time (`removal.removedSince`). A key-only or twin
    token is refused.
  - POST /api/team, on the agent path, reads the caller's exact token name and passes it to the team.
- `engine/remove.js`: a removal history, `removals.jsonl` beside the removed list (append-only: name and time).
  `recordRemoval`, the one point every removal reaches, appends to it (`noteRemoval`); `removedSince(names, since)`
  reads it (slug match, loose on purpose since a match refuses; null when unreadable).
- `engine/team.js` sets `createdByName` on every member: the asking agent's token name when an agent (not the setup
  guide) asked on a named token, else null, so a member cannot set it. `engine/create.js` records it on the birth.
- Tests: `server.agent-remove-4475.test.js` (26); `engine/remove.test.js` (a real removal is added to the history and a
  restore does not erase it); `server.team-agent-token-1279.test.js` (the agent path records the exact token name end
  to end, for a creator whose sessionName differs; the board-token path records none); `engine/team.newrole-4474.test.js`
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
- **Ownership ends the first time the target or the creator is removed after the birth** (review 7). A name is freed
  for reuse only by a removal (then, optionally, deleting what was left, #514), so a later agent under either name,
  made, adopted or partially made, is never the one the birth is about. Rejected: the profile id (reviews 5 and 6
  used it). It survives a removal and is carried to a new agent of the same name, because nothing deletes a
  profile, so it did not tell incarnations apart; its tests deleted the profile by hand and so assumed what they
  were testing.
- Ownership does not come back on restore: the history is not erased by it. The person can remove a restored agent.
- A newer `partial` birth of the name ends the older agent-made one's ownership; a `partial` creation is never
  removable by its creator. Agents made before this change (no `createdByName`), and creators whose token carries no
  name (before #4792), cannot remove; the person can.
- A history that cannot be read refuses. A failed append is logged (best-effort, like the token revoke beside it);
  it is caught by nothing else, so the residual is a removal on a full disk.
- Accepted premise: the wall clock orders a removal after the birth it ends (both are ISO times from it). A backward
  clock step between the two, and a name reused inside that window, would keep ownership. Rejected: a shared sequence
  number across the birth log and the removal history, more machinery than that window warrants.
- Rejected: refusing every agent-token removal (today's behaviour): it keeps "PM, build me a team" from tidying up
  its own team, which #1279 made possible; and a general permission grid now (no asked-for need beyond this boundary).
- Not done: a `kosmos` verb for removal. The doctrine tells agents to use a command or ask the person; with no verb,
  the person still removes from the board. A verb is a follow-up if a PM agent needs it.
- Weakest premise: that every way a name is freed goes through `recordRemoval`. True for the board's removal route
  and the auto-import cleanup (both call `removal.remove`); a person deleting an agent's files by hand outside
  Kosmos, then making a new agent of that name some other way, is not seen.

## Validation
- `server.agent-remove-4475.test.js` 26/26, `engine/remove.test.js` 93/93, `server.team-agent-token-1279.test.js` 21/21,
  `engine/team.newrole-4474.test.js` 22/22, `server.agent-token-gate-4491.test.js` 25/25,
  `server.agent-token-sender-570.test.js` 7/7.
- Mutants, each failing only its own case: the creator check disabled (the refusal cases), the createdByName
  presence check, the key-only refusal, the board-name check, a slug comparison of the creator in place of the exact
  name, the team route recording the sessionName in place of the token name, recordRemoval not adding to the
  history, the target left out of the history check, the creator left out of it, a partial birth not counted, and an
  unreadable history read as no removals.
