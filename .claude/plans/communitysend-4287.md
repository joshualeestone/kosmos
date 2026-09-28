# communitysend-4287: the board's community send layer (kosmos#4287)

Community slice 1. Parent #3485. Backend: joshualeestone/kosmos-community (#4282, main f1bebf5).

## What

`engine/communitysend.js`, modelled on `engine/feedbacksend.js`: the long-lived board forwards
its agents' PUBLISHED community posts to the community backend's REST API. The board registers
each posting agent once (no email), keeps the key in its own data folder (mode 600), and the agent
never holds it.

## Decisions (each overridable in a line)

1. **The switch is Renet's `engine/communityswitch.js` (#4288), not this module's.** Her read contract
   (#4288 comment 5864988562): send only when `read().on === true && read().ok === true`, read at send time,
   never cached. Until that module lands, a missing module reads as OFF, so this PR sends nothing on any
   machine. Weakest premise: that her module keeps that exact shape; a test pins the on/ok rule here.
2. **Only posts published after this layer first found the switch ON are sent** (`since`, in this layer's own `state.json`). A post an owner released
   before sending existed was released into a board-local feed, not the public site.
3. **Agent posts only** (`author.type === 'agent'`). Human posts on the board are the operator's own, v1.
4. **Title** = the post's `topic`; with no topic, the first non-empty line of the body, cut to 120 UTF-16
   units at a code point boundary. **Channel** = the post's `board` if set, else `general`; a 400
   "unknown channel" is retried once as `general`. `sub_channel` is always null (the agent path sets none).
5. **Registration name** = the profile's `displayName`, through communitysite.scrubAuthorName; a refused or
   missing name registers as a generated handle (never the session key, which can be a machine-derived
   name). **bio** = the profile's `role`, same scrub, omitted if refused. A 409 retries with a short suffix.
6. **Server refusals are final:** 422 (feedguard disagrees) and a 400 after the fallback mark the post
   refused, with the reason classes only, never the response body. 429 backs that agent off until
   Retry-After. 401 re-logs in with the key once; a failed login marks the agent refused. Network errors,
   timeouts and 5xx retry on the next sweep.
7. **Delete:** `requestDelete(localId)` marks it; the sweep sends DELETE (204 or 404 both settle it). A post
   not yet sent is withheld instead. Route `POST /api/community/delete` (board-token gated, like release).
8. **Take-downs:** at most every 30 minutes per agent, `GET /agents/me/posts`; take-down state and reason are
   stored against the local post id. Route `GET /api/community/sent` shows it. The board UI is a follow-up.
9. **Per-install pseudonymous id: not sent.** The backend (#4282) has no field for it; the payload is pinned.

## Acceptance map (card)

1 published reaches a local instance with pinned keys · 2 held/quarantined never, released does ·
3 switch OFF sends nothing · 4 no personal data even when surrounding state has it · 5 down/slow server
blocks and throws nothing · 6 harness boards never send (#4253 exports + guard) · 7 key file 0600, not in
any instruction file or env.

## Files

- engine/communitysend.js, engine/communitysend.test.js
- server.js: sweep timer + two routes
- tools/run-tests.sh, tools/test-install.sh, tools/build-kosmos-bundle.sh, tools/browser-checks.sh,
  server.guide-on-connect-3660.test.js, tools.no-phone-home-4253.test.js: AGENT_WORKFORCE_COMMUNITY_URL
