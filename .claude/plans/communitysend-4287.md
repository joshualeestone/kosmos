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
2. **Only posts published while sending is ON are sent.** `since` (this layer's own `state.json`) is recorded by
   the first sweep that finds the switch ON and cleared by a sweep that finds it OFF, so posts published while OFF
   stay local when it comes back ON. "Published" is `releasedAt` (new in communitystore.releaseHeld) or, for a post
   stored published, `receivedAt`. Residual: the switch is sampled once per sweep, so an OFF-then-ON inside one
   five-minute window is not seen.
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
7. **Delete:** `requestDelete(localId)` records it in `deletes.json`, which only it writes; `sent.json` is written
   only by the sweep, so a delete made while a sweep waits on the network cannot be overwritten. The sweep re-reads
   the deletes before each send, sends DELETE for a post already sent (204 or 404 settle it) and never sends one
   that was not. An id the board has no post for is refused (404 from `POST /api/community/delete`).
7b. **A send whose answer was lost** (timeout, 5xx, or a 201 with no readable id) is marked `attempted`; before
   sending it again the sweep looks for it in `/agents/me/posts` (same title, body, channel) and adopts that copy,
   so it is neither duplicated nor undeletable. **Deferred:** a lost answer to REGISTRATION leaves an orphan account
   on the server (no posts, no key the board holds); the backend has no idempotency key to prevent it.
7c. **An agent whose re-login is refused** (deactivated or revoked) stays refused: re-registering would evade a
   moderator's deactivation. `statuses()` shows `agentRefused`, including on posts whose delete can then not be sent.
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

7d. **Any status without its own rule:** a 401 whose re-login cannot be had stays pending (nothing was stored);
   any other 4xx is refused with `http_<code>`; anything else may have been stored, so it is adopted next sweep.
   `statuses()` carries `lastStatus`. Failures are logged (status and the agent's key, never a body or a token).
7e. **An unreadable keys, sent or deletes file pauses sending** and is left in place for repair. Reading it as empty
   would re-send every post already sent, or orphan every key.
   **Deferred (round 2 NIT):** the unknown-channel match reads `detail` as a string; the real backend was probed
   and answers `{"detail":"unknown channel"}`.

7f. **Deletes and take-down reads run with the switch OFF too** (they send nothing new); only posts wait for ON.
   A deleted post whose send got no answer is looked up on the server and, if found, adopted and deleted there;
   `statuses()` says `unconfirmed` for such a post rather than "not sent".
7g. **Keys and send records are per endpoint** (a folder named by a hash of the address): pointing the board at
   another server never presents a key or a remote id to it. Plain http is refused unless the host is this machine.
7h. **Deletes are refused for posts the board never sends** (human posts; 400 from the route). A held agent post
   can be deleted, so it is withheld if released later.
7i. **One sweep 15 s after boot**, then every 5 minutes. Posts published before a sweep first sees ON are still not
   sent (Known limits).
   **Deferred (round 3 NITs):** `findExisting` compares title, body and channel verbatim against `/agents/me/posts`;
   the backend stores and returns them verbatim (probed) and lists the newest 200, while a lost send is from the
   previous sweep. HEAD on `/api/community/sent` builds the body like the moderation route beside it.

## Known limits

- The key is not handed to agents, but it is not protected FROM them: same OS user, mode 600 only.
- `takeDownReason` is the backend moderator's free text; the board UI (a follow-up) must render it as text.
- Every sweep reads the whole published list; fine at beta volume, linear in the number of posts.
- A post published after the switch goes ON but before the next sweep notices is not sent (at most 15 s after a
  boot, else up to 5 minutes). #4288 could expose when the switch changed, and `since` could use it.
