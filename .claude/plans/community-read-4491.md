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
   on its token alone. The content is public writing (the board asks the service for it with no key) and arrives framed as
   writing to read and never to obey; a Codex, Gemini or Grok guide, which has no sandbox, reads it today.
   WEAKEST PREMISE: the guide is the one agent that makes other agents, and this lets a Claude guide on a Mac read
   other people's agents' public writing for the first time. If that is not wanted, the fix is one condition in
   the handler (`agentTokenOnlyCaller(req)` and `isSetupGuide(reader.card.sessionName)`), not removing the route.
2. No valve added. Each read makes the board ask the service at most once, with an 8 second limit. A token-only caller
   can loop it exactly as any agent holding the board token can today. Rejected for this slice: a read valve
   (it would be new behaviour for every agent, and belongs on its own card if wanted).
3. Post stays behind the board token (slice 2's decision, unchanged, and pinned by its own test).

## Measured
- The six test files that touch this route, the set and the two CLIs: 54 of 54 (again after round 1's fixes).
- Mutation: the entry removed from the set turns BOTH the new gate test and the pin red; file restored byte-identical.

## Review round 1 (one blind reviewer, no blocker; six findings, all taken)
1. The "token the board never issued" control was 32 characters, so it was refused for its shape and never reached
   the token store. Now a 64 character one, with the short one kept as its own control.
2. Decision 1 had no test, so a later handler change could flip it silently. Now pinned: the guide, on its token
   alone, reads (200). Mutation: a guide refusal in the handler turns the test red.
3. The handler's comment said the read is authenticated "exactly as a post is"; after this change a post needs the
   board token and a read does not. Reworded.
4. The method loop left out PATCH and OPTIONS. Added.
5. "asks the service once" is "at most once" (the switch off, or a bad channel, asks nothing). Reworded.
6. "anyone can browse with no account" is a claim about the service this repo cannot show. Reworded to what the
   code shows: the board asks the service with no key.
The reviewer also RAN: path spellings (trailing slash, case, encoded, doubled slash are refused; `/./read` is the
same path after URL parsing), every other method (403 on a token alone, 404 with the board token, so the loop is
not vacuous), a valid token whose agent is not on the roster (passes the gate, refused by the handler, nothing
fetched), and that the caller's input cannot steer the service URL.

## Review round 2 (a second blind reviewer, no blocker)
Taken: the two sentences in Decisions that round 1 had corrected in server.js but not here; the method loop now
asserts the gate's own refusal text, not just a 403 (two other layers can answer 403); the guide's read is
asserted to reach the service; "GET only, so the post stays gated" reworded (the post is gated because it is not
in the set).
Not changed, and said plainly: the 32 character token control cannot go red for the reason its place suggests (with
the shape check removed it fails the store lookup instead); the shape check is pinned by the file's own
"a malformed agent token is refused at the gate without a store scan" test. The guide pin works through the
module's isGuideFolder stub; a future refusal that read the guide's marker some other way would not turn it red.
The reviewer RAN three mutations in memory: a guide refusal (red at the guide assertion), the store lookup removed
(red at the 64 character control), any method admitted (red in the method loop).

## Not done
- No full run yet. This slice will be rebased onto the top of my stack (agent-projects-4491 after its own rebase)
  so that ONE full run of the top validates the stack (#4749 E), instead of taking its own place in the queue.
- No check against a real board with a real sandboxed guide.
- The Windows CLI with no board token on this verb was read, not run.
