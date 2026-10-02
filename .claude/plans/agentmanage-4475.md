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
  - The DELETE handler asks `agentTokenOnlyCaller(req)`. For a caller that came through on its token alone it refuses
    `?force` (the person's override) and refuses any target `tokenOnlyMayRemove` does not allow (403, in step 1's
    doctrine words). A caller holding the board token (the person, the page, every non-token-only agent) is untouched.
  - `tokenOnlyMayRemove` allows only when the target's newest `created` birth (`agentBirthOf`, activeAgentsCreatedBy's
    rule) was made at an agent's own request (`createdByAgent`), carries the target's current profile id, names the
    caller as creator (by slug), and the caller's token carries its agent's name (not an older key-only token).
- `engine/team.js` sets `createdByAgent` on every member it creates: true only when an agent asked on its own token
  and it is not the setup guide; false otherwise, so a member cannot set it. `engine/create.js` records it on the birth
  line when true.
- Tests: `server.agent-remove-4475.test.js` (18), `engine/team.newrole-4474.test.js` (createdByAgent sorted as a field
  the team sets; a test that an agent cannot set it), and the pins in `server.agent-token-gate-4491.test.js` and
  `server.agent-token-sender-570.test.js` (the route list, and the token-only call-site count now 3).

## Decisions
- Scope, stated as the card's spike did: real enforcement only for a TOKEN-ONLY agent, which cannot present the
  board token (#4491 keeps it unreadable, slice 9 stops it sending one). An agent that can still read the board
  token is indistinguishable from the person, so for it this stays advisory (step 1's doctrine). It widens as
  token-only becomes the default.
- Only an agent-made birth counts. The person's paths record a fixed creator word ("operator" from the org-chart
  import, "kosmos" for the setup guide) and an agent can take either as its name; without `createdByAgent` an agent
  named "operator" could remove everything the person imported (review 1).
- The setup guide's creations are the person's: it makes agents on the person's behalf, so its births are not marked
  and it cannot remove them. Rejected: letting it, as any other creator.
- A birth counts only for the incarnation it made (profile id), so a name freed by deleting what was left (#514) and
  used again is not the old creator's. A birth with no id (a dry run, or before #170) does not count.
- Agents made before this change have unmarked births, so their creators cannot remove them; the person can.
- Rejected: refusing every agent-token removal (today's behaviour): it keeps "PM, build me a team" from tidying up
  its own team, which #1279 made possible; and a general permission grid now (no asked-for need beyond this boundary).
- Not done: a `kosmos` verb for removal. The doctrine tells agents to use a command or ask the person; with no verb,
  the person still removes from the board. A verb is a follow-up if a PM agent needs it.
- Weakest premise: that a new agent under a reused name always has a new profile id. True when its profile was
  deleted (leftover deletion); an agent made by hand into a folder whose old profile file survived would keep the old id.

## Validation
- `server.agent-remove-4475.test.js` 18/18. Mutants, each failing only its case: the creator check disabled (the 5
  refusal cases), the createdByAgent check, the profile-id check, the key-only refusal.
- `engine/team.newrole-4474.test.js` 22/22.
- `server.agent-token-gate-4491.test.js` 25/25; `server.agent-token-sender-570.test.js` 7/7.
