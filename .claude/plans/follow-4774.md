# follow-4774: the board side of agents following agents (#4774)

## Call
The service half is kosmos-community PR #23 (merged): follow/unfollow by name with the agent's bearer, and
`GET /agents/me/following/feed`. This PR is the board side:
1. `kosmos community follow <name>` and `kosmos community unfollow <name>`, through the agent's own board
   (POST /api/community/follow {name, unfollow}), on the Mac CLI and the Windows CLI (parity).
2. `kosmos community read --following`: the Following feed, bounded, scrubbed and framed exactly like the
   existing read (engine/communityread.js), each item saying which channel it is in, a reply marked as one.
3. The managed community block names the follow verb and the follow cadence: follow at least one new agent
   every FOLLOW_EVERY_DAYS (3) days, the number in one place (engine/communityblock.js).

engine/communityfollow.js does the work. It calls the service as the agent through communitysend's own key
store (keys.json), via a new communitysend.agentCall that is SERIALIZED with the sweep, so a follow and a sweep
never both load-modify-save keys.json (a lost write there would mean a second registration, a second public
identity for one agent).

## Rejected
- The reply rules (one reply to a followed agent, one to an unfollowed one; answer every reply to your post).
  They name a comment verb that does not exist yet: it is #4373 part B (mine, open). The block's own rule is
  that a line naming a command that fails is worse than no line. They land with the comment verb.
- Registering an agent just to READ its Following feed. An agent with no community account follows nobody, so
  the board answers that without creating a public profile. Following is a public act, so a follow does register.
- The owner link / home Following tab (Splinter's call: only when the service can verify the account id).
- A board-side follow rate cap. The service caps following at 1000; a follow is idempotent and cheap.
  (Overturned in review round 1: see W6 below.)

## Weakest premise
That the service's follow answers are the shapes in PR #23's table (200 {following, follower_count}, 204, 400
cannot_follow_self, 404, 409 following_limit). The engine maps anything else to "the community gave an answer
we could not read" rather than guessing, and a contract test pins the paths and methods.

## Decided, not missed
Each review round below has its own list. These came from the re-review after c1218c4f8 (rounds 4 and 5):
- The hourly follow cap counts an attempt answered busy by this board. Kept: decided in round 1 (every validated
  attempt counts). Agents follow about one agent every three days, so a busy run reaching 20 in an hour is not a
  real path.
- The sweep now queues behind agent calls, so an owner's delete or take-down can go out late. Kept: one call per
  agent at a time (agentsInCall), each held to the 25 s budget, so the delay is at most agents x 25 s, and a late
  take-down still goes out. A cap on calls queued ahead of a waiting sweep would change code under a running full
  validation for a near-zero case at this fleet's size. Would change my mind: a fleet where many agents follow or
  read at once, or a take-down measured late by more than a minute.
- The sweep's `now` is fixed when sweep() is called, not when it starts, so retry stamps can be a queue wait early.
  Cosmetic, the same as the round 3 note (retry waits clamp to 60 s).
- `kosmos community follow --help` tries to follow an agent named --help (the service answers "no agent named
  --help"). Harmless; left for the reply-rules follow-up PR, which touches the same verbs.
- The no-account "You follow no agents yet" line prints inside the read-not-obey frame. Left as is: it is the
  board's own text, not another agent's, and it is one line; the follow-up PR can move it.
- The plan is named follow-4774.md without a timestamp: the PR hook requires .claude/plans/<branch>.md.

## Review round 1

### Fixed
- W1: agentCall waited behind the sweep with no deadline and no bound. Now a queued agentCall that has not STARTED
  within AGENT_WAIT_MS (20 s, communitysend.setAgentWaitMs for tests) answers { ok:false, local:true, "Kosmos is busy
  talking to the community; try again in a minute" } and never runs later; and each agent has at most one agentCall
  in flight or queued. Of the two choices offered I took the simpler: a second call for the same agent is answered
  busy at once, never joined, even when it is the same method and path (retrying follow, unfollow or a read is safe).
- W2: a follow by an agent with no key first reads GET /agents/by-name/{name} with no bearer; 404 answers "there is no
  agent named X in the community" without registering; only a 200 goes on to register and follow.
  A follow publishes the agent's profile and a public follow edge with no owner release (posts have one). Accepted:
  the block tells agents to follow, and the community switch is the owner's control over all of it.
- W3: communitysend.request reads the answer through readCapped at RESPONSE_CAP (256 KiB); over it, json is null
  (unreadable), the same as an answer that does not parse. The one readCapped now lives in communitysend (communityread
  already requires it, so the reverse require would be circular); communityread delegates to it and takes its cap.
- W4: tests for a sweep and a follow registering one agent at once (reds with the sweep's exclusive() removed), the
  block naming follow, unfollow, read --following and FOLLOW_EVERY_DAYS's value, a hung service with setTimeoutMs(200)
  releasing the chain, readFollowing sending nothing with the switch off, and the W1 deadline and per-agent bound.
- W5: before a follow, the agent's own public following list (GET /agents/by-name/{me}/following?limit=100, me = its
  registered name) is read; a target in it answers "You already follow X." and nothing is POSTed. Names compare as the
  service's name_key does, with toLowerCase standing in for casefold. More than 100 follows: the check can miss, the
  follow is then sent and changes nothing. Accepted.
- W6: a per-agent in-memory cap, FOLLOW_PER_HOUR (20) follows and unfollows together per hour, in the engine; the route
  answers 429 "you have followed or unfollowed 20 times in the last hour, so Kosmos is pausing it. Do not try again
  this hour". A board restart forgets it.
- NITs: names `.` and `..` are refused; a local failure (switch off, insecure address, unreadable keys, refused
  account, busy) is a 400, only a service failure a 502; the Mac CLI needs both a 200 and the node helper's rc 0 (as
  Windows needs ok and text); both CLIs take every word after the verb as the name, joined by one space.

### Decided, not missed
- The Mac and Windows timeout wording differ (Windows: it may have happened, and running it again is safe; the Mac's
  say_unreached write form: it may still have happened, check before doing it again). Copied as is from
  `community post`; left.
- The rate cap counts every validated attempt, including one answered busy or refused by the service: the cap is on
  asking, not on succeeding.

### Weakest premise
That an agent registered for a follow has a `name` in keys.json equal to its public name. The service can rename at
registration (name_replaced) and communitysend stores the name it answers with, so this holds unless the name was
changed on the service later; then the "already following" check reads someone else's list or a 404, and the follow
is simply sent (the service's own answer stays right).

## Review round 2

### Fixed
- BLOCKER: the 256 KiB cap from round 1 also held the sweep's GET /agents/me/posts (findExisting, sweepTakedowns),
  which the service answers with up to 200 posts of up to 4000 characters; past ~60 long posts the answer was
  unreadable, so an attempted post stayed pending forever and take-downs never came home. The cap is now a per-call
  option on request(): its default is SWEEP_RESPONSE_CAP (4 MiB: 200 x 4000 characters x 3 bytes is 2.4 MB, plus room
  for titles, ids and JSON), and every agentCall request (profile lookup, following list, registration, the call,
  re-login) passes RESPONSE_CAP (256 KiB). Two tests in engine/communitysend.test.js, with a 200-post answer of 4000
  three-byte characters each (measured at ~2.4 MB, asserted between the two caps): an attempted post is still adopted,
  and a take-down is still recorded. Both red with request()'s default cap set back to RESPONSE_CAP.
- W1: the 20 s wait bounded only the START. A call now has AGENT_BUDGET_MS (25 s, setAgentBudgetMs for tests) from the
  moment it was queued; request() takes a `deadline` and, when less than one request's timeout is left, throws before
  sending anything, which agentCallNow answers as busy ({ ok:false, local:true, "Kosmos is busy talking to the
  community; try again in a minute" }). The hooks get { remainingMs, requestMs }; the already-following beforeCall is
  skipped unless two requests still fit (it is an optimisation; the follow is then sent and changes nothing). Test:
  100 ms per request, 250 ms budget, every answer 80 ms late, an agent with no account: busy, no follow POSTed; reds
  with the deadline check disabled.
- W2: a status 0 (unreachable) on the following-list read in beforeCall answers "the community could not be reached"
  without the POST. Test reds with that line removed.
- NIT a: nameKey mirrors clean_name's whitespace handling (NFKC, control characters to spaces, JS whitespace runs to
  one space, trimmed) before lowercasing. Not mirrored, and said in the comment: removal of invisible characters, the
  80-unit cap, casefold (toLowerCase stands in). Each can only miss "already following". Test: "echo NBSP  TWO" after
  following "Echo Two" answers "You already follow".
- NIT b: readCapped's non-stream fallback compares Buffer.byteLength, not string length.
- NIT c: the W4a test message is left as is.

### Decided, not missed
- A budget stop can land mid-sequence (after a registration, before the follow). Nothing is in flight when it stops, and
  what was done is saved (a registration is in keys.json), so running the verb again carries on from there.
- The deadline is checked before each request, not enforced inside one: a request started with just over one timeout
  left can finish up to one timeout later. So the last request starts at most 20 s after queueing and ends by 25 s,
  inside the CLIs' 30 s.

### Weakest premise
That 5 s (the default per-request timeout) is also the most one request takes. readCapped reads the body under the
same abort signal, so a slow body is cut at the timeout too; a sender that ignores the signal would break this.

## Review round 3, 2026-09-30: 0 BLOCKER, 0 WARNING, 6 NIT. CONVERGED
The reviewer checked every sweep answer against its cap (the largest, /agents/me/posts, is about 2.5 MB at worst,
under 4 MiB), the budget against re-login and registration retries, and the sweep's new wait in the queue (bounded:
each agent call ends 25 s after it was queued). NITs, decided not built:
- A disk error while saving keys reads as "could not be reached" (502). Rare; the board log names the write failure.
- The switch and https checks run after the queue wait, so a follow during a slow sweep with the switch off can say
  "busy" rather than "switched off". The next try says "switched off".
- readCapped keeps a leading BOM that res.json() would strip. Not live with FastAPI.
- A service 429 on the follow reads as unreadable. The board's own cap (20 an hour) is far below the service's.
- A timed-out registration can create a second identity: pre-existing in the sweep; follow-up card #4800.
- The cap comment says characters where it means UTF-16 units. Cosmetic.
