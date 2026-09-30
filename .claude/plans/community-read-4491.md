# #4491 slice 6: `kosmos community read` answers to the agent's own token

Card: joshualeestone/kosmos#4491 (claimed:angel). Branch community-read-4491, off main 844b2372a.
Addresses #4491 (the card stays open: the bridges, the hook and the CLI switch come after).

## What finished looks like
On a board that enforces the board token, `GET /api/community/read` with only a valid `x-kosmos-agent-token`
returns the framed community text. Every other method on that path, a token the board never issued, a token in
the query, and `POST /api/community/post` on a token alone are all still refused at the gate.

## The change
- server.js: `'GET /api/community/read'` joins `AGENT_TOKEN_ROUTES`, with a comment that says who gains.
  The handler is untouched: it already refuses a caller without a token the board issued and resolves the reader
  from it (presentedAgentToken, resolveAgentSender).
- server.agent-token-sender-570.test.js: the exact pin of the set gains the entry.
- server.agent-token-gate-4491.test.js: one new test on the enforcing board.
- Neither CLI changes: both already send the agent token on this verb, and the Mac one tolerates having no board
  token (`board_token || true`).

## Decisions (mine, reversible in one line)
1. Open to ANY valid agent token, the sandboxed setup guide included. Rejected: refusing the guide when it comes
   on its token alone. The content is public (anyone browses the community with no account) and arrives framed as
   writing to read and never to obey; a Codex, Gemini or Grok guide, which has no sandbox, reads it today.
   WEAKEST PREMISE: the guide is the one agent that makes other agents, and this lets a Claude guide on a Mac read
   other people's agents' public writing for the first time. If that is not wanted, the fix is one condition in
   the handler (`agentTokenOnlyCaller(req)` and `isSetupGuide(reader.card.sessionName)`), not removing the route.
2. No valve added. Each read makes the board ask the service once, with an 8 second limit. A token-only caller
   can loop it exactly as any agent holding the board token can today. Rejected for this slice: a read valve
   (it would be new behaviour for every agent, and belongs on its own card if wanted).
3. Post stays behind the board token (slice 2's decision, unchanged, and pinned by its own test).

## Measured
- The six test files that touch this route, the set and the two CLIs: 54 of 54.
- Mutation: the entry removed from the set turns BOTH the new gate test and the pin red; file restored byte-identical.

## Not done
- No full run yet. This slice will be rebased onto the top of my stack (agent-projects-4491 after its own rebase)
  so that ONE full run of the top validates the stack (#4749 E), instead of taking its own place in the queue.
- No check against a real board with a real sandboxed guide.
- The Windows CLI with no board token on this verb was read, not run.
