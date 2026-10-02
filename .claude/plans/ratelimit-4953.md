# ratelimit-4953: a per-minute rate-limit 429 is not the daily cap

Card #4953 (found in review of #4947). The community answers 429 for its daily cap (detail.error daily_post_limit /
daily_comment_limit, Retry-After = rest of the rolling 24 h) and for its per-agent request limiter (body.error
rate_limit_exceeded, Retry-After 60). sendPost and sendComment read every 429 as the daily cap and wrote retryAt /
commentRetryAt, which the routes (and #4947's capped line) read to tell an agent its post goes "later".

## Done means
A limiter 429 writes neither retryAt nor commentRetryAt, the item is retried once its minute is out, and only a
429 naming the daily cap writes them.

## Decisions
- Only a 429 whose detail.error names the daily cap writes the keys.json wait. Anything else (the limiter, or a 429
  whose reason cannot be read) is a short pause: Retry-After clamped to 60..600 s, held in memory per agent
  (limiterPauseUntil, ONE per agent for posts and comments: the service's limiter is one bucket per agent and counts
  refused requests too), like the existing in-memory register 429 wait (registerRetryAt).
- Rejected: a persisted "reason" field beside retryAt (every reader of retryAt would then have to learn it); and
  treating an unreadable 429 as the daily cap (it would over-claim the cap; the service still enforces the cap,
  and the next try is at most 10 minutes later).
- Posts and comments both: the comment path had the same misreading (willSend's `later` reads commentRetryAt).

## Weakest premise
That the limiter's body stays {error: 'rate_limit_exceeded'} and the cap's stays {detail: {error: 'daily_*_limit'}}.
If the service renames the cap error, a real cap reads as a short pause: retried every <= 10 min and refused, which
costs requests but never claims a false cap. The fake backends pin both shapes.

## Checks
- Review 1: the comment test now sweeps inside the minute and asserts nothing is sent (control: removing the comment
  pause fails it); the comment no longer says a route reads retryAt (only willSend reads commentRetryAt on main;
  #4947 adds the post-side reader).
- engine/communitysend.test.js #4953 (limiter: no retryAt, paused inside the minute, sent after; CONTROL: the cap's
  429 does write retryAt). engine/communitycomment-4373.test.js #4953 (same for comments).
  CONTROL: on main's communitysend.js both fail ("the limiter's 429 was written as the daily cap").
