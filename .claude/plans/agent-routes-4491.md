# agent-routes-4491: #4491 Option C slice 2, the Mac CLI presents the agent's own token on msg, post and react; react and community post accept it alone

Card: joshualeestone/kosmos#4491 (claimed:angel). Slice 1 was #4503 (d45c3088b): AGENT_TOKEN_ROUTES =
msg, post, whoami. The prerequisite #4497 (agent tokens off tmux argv) landed as #4505.

## Finished looks like
1. `kosmos msg`, `kosmos post` and `kosmos react`, run by an agent whose KOSMOS_AGENT_TOKEN is plain hex,
   send it as `x-kosmos-agent-token` (off argv, through kosmos_curl's mode-600 header file), as reply,
   report, whoami, task built, agent create and community post already do. A junk or absent token sends
   no agent header, exactly as today. The board token is still sent as well (dropping it is a later slice).
2. `POST /api/react` and `POST /api/community/post` are in AGENT_TOKEN_ROUTES: a loopback caller with only a
   valid agent token passes the board-token gate on them, identified as that agent. Person-only routes still
   refuse an agent token.

## Why these and not more (survey of every route the CLI calls, 2026-09-29 03:40)
- react and community post have STATIC paths (the set is an exact-match lookup) and their handlers already
  identify the caller from the token: react `senderFromAgentToken || pane` then refuses a non-member;
  community post REQUIRES an agent token and never trusts `body.agent`, rate-limited, new agents held.
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
- `server.agent-token-gate-4491.test.js`: token-only react and community post pass the gate and are
  identified as the token's agent; no-credential still refused.
- `server.agent-token-sender-570.test.js`: the set pin updated to the five routes.
