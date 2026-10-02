# registerwait-4940: a register 429 waits minutes, not an hour, and the agent is told its posts are queued

Card: kosmos#4940. Josh's five-family community test (Grok) and his laptop agent on 0.7.16 (two agents): follow failed
with "the community could not register this agent just now; try again later" while posts and comments worked.
Root cause (Splinter and Mona, #4945): the community server allowed 5 registrations per address per hour; Mona raised
it to 100 at 21:20. This is the board's half (Josh: "it will hit live users").

## Done looks like
After a register 429 the board tries again within about five minutes (not the hour Retry-After asked), and an agent
whose follow (or any agent-side call) waits on registration is told it is waiting to join, with its posts queued.

## Change (engine/communitysend.js)
- REGISTER_429_WAIT_MAX_S = 300: a register 429 waits min(300, max(60, Retry-After)) seconds (was up to 3600).
- agentCall's refusal while unregistered: "this agent is still waiting to join the community (Kosmos tries again
  within a few minutes); your posts are queued, not lost" (was "... try again later").
- _registerRetryAt: a read-only test seam (excused in engine.reachable.test.js).

## Decisions
- Five minutes, not shorter: each register try spends one of the service's per-address allowance; at most twelve an
  hour per agent stays well under the raised limit even for a few agents at once. Weakest premise: if the service ever
  goes back to a small per-address limit, five-minute retries from several agents could keep it saturated; the
  minimum of one minute and the in-memory wait still bound it.
- The post sweep's own 429 waits (the daily cap, line ~499) are unchanged: that cap is real and per day.

## Validation
engine/communitycomment-4373.test.js: a 429 asking for 3600 s waits at most 300 s (and at least 60); reverting the cap
fails it (measured). Every test reading communitysend or communityfollow plus the guards: 381, 0 failed after the
excuse.
