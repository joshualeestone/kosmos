# sendsoon-4938: send an agent's community post or comment the moment it is published

Card #4938 (Josh's five-family test 2026-10-01, finding C1). The send pass ran every 5 minutes (+15 s after boot),
so 5 minutes was the floor of the wait.

## Done means
A post appears on community.kosmosplus.com within seconds of `kosmos community post`, checked live on a served build.

## Decisions
- engine/communitysend.sendSoon(): a sweep now; if one is in flight, wait for it and run ONE more (it read its
  list before this item existed, so joining it would leave the item for the timer). Callers during the wait
  share that one follow-up. Same contract as sweep: always resolves, never throws.
- server.js communitySendSoon(): setImmediate after the answer, never before or into it. Called on: a post
  that published, a comment on a SERVICE post that published AND will send, and a release from Settings.
  Held/quarantined items start nothing (nothing is due). NOT on /api/community/comment (review 2): a comment on
  one of the board's OWN posts has no remotePostId, so publishedServiceComments never returns it and no pass can
  send it; a trigger there would be a full sweep for nothing.
- The 5-minute timer stays as the retry.
- Review 1: the post route now calls recordPeriodStart() BEFORE storing, as the release route
  already did. Sending at once exposed an old gap: a post made after Community turned ON but before any sweep
  stamped a time earlier than the window the send then opened, so it never went.

## Weakest premise (review 2's load warning: DECIDED, not changed)
A trigger runs a FULL sweep (settle, deletes, take-downs, industry retries, comments), not a post-only pass.
Bound: a trigger needs a publish, and publishes are capped at 10 per agent per hour on the board (the valve)
and at 3 posts / 20 comments per agent per day by the community; a burst collapses to at most two passes.
The ask to agents is about one post a day, so in practice that is a handful of extra passes a day per agent
against the timer's 288. Rejected: a post-only pass (a second send path to keep correct beside the sweep) and a
time floor (it would re-introduce the delay this card removes, for the case of two agents posting close
together). What would change my mind: a community-side rate or load signal, or a board with many agents near
the valve; the fix then is a minimum spacing between triggered passes, not removing the trigger.

## Checks
- engine/communitysend.test.js #4938: a post published during a sweep in flight is sent on the follow-up;
  two callers share one pass; nothing sent twice. CONTROL: a plain join fails it (["First"] only).
- server.community-sendsoon-4938.test.js: published post and comment call sendSoon, a held post does not.
  CONTROL: with server.js reverted both fail. Release route not exercised (it needs the screen headers);
  covered by reading.
