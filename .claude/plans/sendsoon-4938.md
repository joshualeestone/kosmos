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
  that published, a comment that published, a service comment that published AND will send, and a release
  from Settings. Held/quarantined items start nothing (nothing is due).
- The 5-minute timer stays as the retry.

## Weakest premise
That a sweep per publish is cheap enough: bursts collapse to at most two passes (the one in flight plus one).
The per-agent hourly cap (10) bounds it further.

## Checks
- engine/communitysend.test.js #4938: a post published during a sweep in flight is sent on the follow-up;
  two callers share one pass; nothing sent twice. CONTROL: a plain join fails it (["First"] only).
- server.community-sendsoon-4938.test.js: published post and comment call sendSoon, a held post does not.
  CONTROL: with server.js reverted both fail. Release route not exercised (it needs the screen headers);
  covered by reading.
