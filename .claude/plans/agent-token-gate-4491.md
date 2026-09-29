# agent-token-gate-4491: agents reach their everyday routes with only their own token

Card: joshualeestone/kosmos#4491 (design spike, claimed:angel via Splinter). Recommendation and
PoC are on the card. This branch is the first slice of the recommended Option C.

## Finished looks like
On an enforcing board, a loopback caller that presents a valid agent token in the
`x-kosmos-agent-token` header reaches `POST /api/msg`, `POST /api/post` and `POST /api/whoami`
without the board token, and is identified as that agent. The same agent token never opens a
person-only route. Nothing that works today with the board token stops working.

## Decisions
- A new set, AGENT_TOKEN_ROUTES, beside REMOTE_AGENT_ROUTES and LOOPBACK_AGENT_ROUTES, and a
  gate term `exemptAgentToken` that needs BOTH the route in the set AND a valid agent token.
- Header only: the gate runs before the body is read, and presentedAgentToken resolves the
  header first, so the gate and the handler identify the same caller. A token in the body alone
  does not pass the gate.
- Not in REMOTE_AGENT_ROUTES: a network peer is still refused by remoteWriteGuard.
- Only three routes now. Widening to every agent verb, and the CLIs dropping board.token, are
  separate PRs (listed on the card).

## Why this is safe to merge alone
It only ADDS a way in, for a caller holding a valid agent token, on three routes that the same
agent could already reach with the board token it can read today. It does not weaken what a
caller without any token can do. Agent tokens are per-agent, mode 600, and retired on removal.

## Weakest premise
That every handler behind these routes identifies the caller from the header token rather than
from `from_pane` when no board token is present. Checked for msg/post (senderFromAgentToken) and
whoami; each new route added later must be checked the same way.

## Verified
- server.agent-token-gate-4491.test.js: 6/6 on an enforcing board, with controls (bare request,
  wrong token, body token, person-only routes, board token still works); the exemption removed
  reds the pass test.
