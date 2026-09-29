# agent-routes-4491: #4491 Option C slice 2, the Mac CLI presents the agent's own token on msg, post and react; react accepts it alone

Card: joshualeestone/kosmos#4491 (claimed:angel). Slice 1 was #4503 (d45c3088b): AGENT_TOKEN_ROUTES =
msg, post, whoami. The prerequisite #4497 (agent tokens off tmux argv) landed as #4505.

## Finished looks like
1. `kosmos msg`, `kosmos post` and `kosmos react`, run by an agent whose KOSMOS_AGENT_TOKEN is plain hex,
   send it as `x-kosmos-agent-token` (off argv, through kosmos_curl's mode-600 header file), as reply,
   report, whoami, task built, agent create and community post already do. A junk or absent token sends
   no agent header, exactly as today. The board token is still sent as well (dropping it is a later slice).
2. `POST /api/react` is in AGENT_TOKEN_ROUTES: a loopback caller with only a valid agent token passes the
   board-token gate on it, identified as that agent. `POST /api/community/post` is deliberately NOT (below). Person-only routes still
   refuse an agent token.

## Why these and not more (survey of every route the CLI calls, 2026-09-29 03:40)
- react has a STATIC path (the set is an exact-match lookup) and its handler already identifies the caller
  from the token (`senderFromAgentToken || pane`), then refuses a non-member. It writes only inside this board.
- DECIDED (review round 1), community post is NOT added although its handler is equally safe on identity: it
  writes to the PUBLIC feed. Today it needs the board token AND an agent token. With the agent token alone, an
  agent that cannot read board.token (the sandboxed setup guide, #3769) could publish, and a trusted agent's
  post publishes immediately (not held). Something public under Josh's name is irreversible, so widening it is
  his call, not a slice's. Rejected: adding it with a note. What would change it: Josh saying agents without
  the board token may post publicly, or a hold on every token-only post. Consequence: when a later slice drops
  board.token from the CLI, `kosmos community post` needs its own answer.
- Not now, each with its reason (next slices, listed on the card):
  - task message and task built: parameterized paths, need a regex term; task message also lacks a
    membership check.
  - task add and project create: identity comes from the pane, not the token (a token-only caller is `by: null`);
    project create accepts any agent names.
  - task close, room read, task list: no caller identity or project scoping at all.
  - Must stay person-only: board-nonce (redeems for the person's cookie), room reopen (the loop guard is the
    operator's), the service-token doors (cloudflare, svc/<svc>/token).

## Weakest premise
Sending the token on msg/post/react changes one failure: a presented token that does not resolve is REFUSED
(senderFromAgentToken, by design: a bad credential is never swapped for the weaker pane). Today such an agent's
msg/post/react still work by pane. I judge this acceptable because reply and report already present the same
token, so an agent with a stale token is already refused on its two most frequent calls; this adds no new kind
of failure, and the Windows CLI has sent the token on these three since #570. What would change my mind: a
class of Mac agent that legitimately carries a token the board cannot resolve.

## Tests
- New `cli.agent-token-verbs-4491.test.js`: a stub board records the headers `msg`, `post` and `react` send;
  valid hex token -> header equals it; junk -> no header; unset -> no header (the valid case is the control
  that makes the absent cases mean something). Sandboxed KOSMOS_HOME so the real board.token is never read.
- `server.agent-token-gate-4491.test.js`: token-only react passes the gate and is recorded as the token's agent
  (control: another agent's token is recorded as that agent); token-only community post is REFUSED at the gate
  (control: board token + agent token passes); no-credential still refused on all three.
- `server.agent-token-sender-570.test.js`: the set pin updated to the four routes.
