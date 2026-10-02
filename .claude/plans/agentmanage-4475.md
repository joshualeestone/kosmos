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
  - `tokenOnlyMayRemove` allows only when the target's newest `created` birth (`agentBirthOf`, activeAgentsCreatedBy's
    rule) carries `createdByName` equal to the caller's token name exactly, and that birth's profile id is the
    target's current one. A key-only or twin token is refused.
  - POST /api/team, on the agent path, reads the caller's exact token name and passes it to the team.
- `engine/team.js` sets `createdByName` on every member: the asking agent's token name when an agent (not the setup
  guide) asked on a named token, else null, so a member cannot set it. `engine/create.js` records it on the birth.
- Tests: `server.agent-remove-4475.test.js` (22); `server.team-agent-token-1279.test.js` (the agent path records the
  name end to end, the board-token path records none); `engine/team.newrole-4474.test.js` (createdByName sorted as a
  field the team sets, and who gets one); the pins in `server.agent-token-gate-4491.test.js` and
  `server.agent-token-sender-570.test.js` (the route list, and the token-only call-site count now 3).

## Decisions
- Scope, stated as the card's spike did: real enforcement only for a TOKEN-ONLY agent, which cannot present the
  board token (#4491 keeps it unreadable, slice 9 stops it sending one). An agent that can still read the board
  token is indistinguishable from the person, so for it this stays advisory (step 1's doctrine). It widens as
  token-only becomes the default.
- The creator is matched by its EXACT token name, recorded on the birth (`createdByName`). `createdBy` is not used:
  it is the card's sessionName, a slug with a pane and a lossy store key without one, so any comparison with it is
  either too loose (dr-kip and drkip, Ca.sey and casey) or too strict (an adopted "Casey"). Reviews 2 and 3.
- The person's paths record no `createdByName`. They do record fixed creator words ("operator" from the org-chart
  import, "kosmos" for the setup guide) in `createdBy`, and an agent can take either as its name; without this rule
  an agent named "operator" could remove everything the person imported (review 1).
- The setup guide's creations are the person's: it makes agents on the person's behalf, so its births carry no name
  and it cannot remove them. Rejected: letting it, as any other creator.
- A birth counts only for the incarnation it made (profile id), so a name freed by deleting what was left (#514) and
  used again is not the old creator's. A birth with no id (a dry run, or before #170) does not count.
- Agents made before this change have births with no `createdByName`, so their creators cannot remove them; the
  person can. So does a creator whose token carries no name (minted before #4792).
- Rejected: refusing every agent-token removal (today's behaviour): it keeps "PM, build me a team" from tidying up
  its own team, which #1279 made possible; and a general permission grid now (no asked-for need beyond this boundary).
- Not done: a `kosmos` verb for removal. The doctrine tells agents to use a command or ask the person; with no verb,
  the person still removes from the board. A verb is a follow-up if a PM agent needs it.
- Weakest premise: that a new agent under a reused name always has a new profile id. True when its profile was
  deleted (leftover deletion); an agent made by hand into a folder whose old profile file survived would keep the old id.

## Validation
- `server.agent-remove-4475.test.js` 22/22, `server.team-agent-token-1279.test.js` 20/20. Mutants, each failing only
  its cases: the creator check disabled (the refusal cases), the createdByName presence check, the profile-id check,
  the key-only refusal, the board-name check, a slug comparison of the creator in place of the exact name.
- `engine/team.newrole-4474.test.js` 22/22.
- `server.agent-token-gate-4491.test.js` 25/25; `server.agent-token-sender-570.test.js` 7/7.
