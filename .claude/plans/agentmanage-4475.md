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
  - `agentCreatorOf(name)`: the creator from the birth log by activeAgentsCreatedBy's rule (the newest `created`
    birth for the name's slug wins); null when there is none. `tokenOnlyMayRemove` compares creator and caller by slug.
- `server.agent-remove-4475.test.js`: own creation passes to the engine; another agent's creation, no recorded
  creator, itself, a refused birth, and force are refused; the creator matched by slug; the newest birth decides;
  the person and a both-tokens caller are untouched; a revoked token is refused at the gate; GET plan and restore
  still need the board token. Two controls (bare request refused at the gate; the board token reaches the engine).
- `server.agent-token-gate-4491.test.js`: DELETE removal moves out of "never opens a person-only route" (GET removal
  goes in, so the list still covers the route).
- `server.agent-token-sender-570.test.js`: the pinned pattern list and the token-only call-site count (now 3).

## Decisions
- Scope, stated as the card's spike did: real enforcement only for a TOKEN-ONLY agent, which cannot present the
  board token (#4491 keeps it unreadable, slice 9 stops it sending one). An agent that can still read the board
  token is indistinguishable from the person, so for it this stays advisory (step 1's doctrine). It widens as
  token-only becomes the default.
- An agent with no recorded creator (made by the person, or before the birth log) is removable only by the person.
- Rejected: refusing every agent-token removal (today's behaviour): it keeps "PM, build me a team" from tidying up
  its own team, which #1279 made possible; and a general permission grid now (no asked-for need beyond this boundary).
- Not done: a `kosmos` verb for removal. The doctrine tells agents to use a command or ask the person; with no verb,
  the person still removes from the board. A verb is a follow-up if a PM agent needs it.
- Weakest premise: that `createdBy` in the birth log is the creator's slug-stable session name. POST /api/team sets it
  from the authenticated caller's card (`sender.card.sessionName`), and activeAgentsCreatedBy already relies on it.

## Validation
- `server.agent-remove-4475.test.js` 14/14; mutant (creator check disabled) fails the 5 refusal cases.
- `server.agent-token-gate-4491.test.js` 25/25; `server.agent-token-sender-570.test.js` 7/7.
