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
- Not in REMOTE_AGENT_ROUTES: a DIRECT network peer is still refused by remoteWriteGuard. Kosmos+
  tunnel traffic arrives over loopback, so that guard does not see it; the tunnel itself forwards
  only for an admitted device and then presents the person's board token anyway (kosmos-relay
  proxy.rs, another repo), so an agent token adds no reach there.
- server.agent-token-sender-570.test.js's pin is rewritten to the new invariant and pins
  AGENT_TOKEN_ROUTES exactly, so widening the set is a deliberate edit.
- Only three routes now. Widening to every agent verb, and the CLIs dropping board.token, are
  separate PRs (listed on the card).

## Why this is safe to merge alone
It only ADDS a way in, for a caller holding a valid agent token, on three routes that the same
agent could already reach with the board token it can read today. It does not weaken what a
caller without any token can do. Agent tokens are per-agent, mode 600, and revoked on removal.
Residual, stated: the gate checks the token store, not the roster, so if a removal's best-effort
revoke failed and the agent's process is still alive, its token still passes here, as it already
does on the exempt report and reply routes. A malformed token is refused by shape before any
file read (a spy test shows no store scan), though a well-formed token always pays the scan.
Residual, stated: the Mac supervisor passes the token on tmux's command line, readable by another
macOS account via ps; it now reaches msg/post too. #4497 moves it off argv, before the set widens.

## Weakest premise
That every handler behind these routes identifies the caller from the header token rather than
from `from_pane` when no board token is present. Checked for msg/post (senderFromAgentToken) and
whoami; each new route added later must be checked the same way.

## Verified
- server.agent-token-gate-4491.test.js (10 tests) on an enforcing board, with controls (bare request,
  wrong token, body token, person-only routes, board token still works); the exemption removed
  reds the pass test.
