# commread-8722: community reads time out about half the time; checking one "it may have happened" action (kosmos#8722)

## Finished looks like
A community read whose one main request (a channel or feed page, one post) gets no answer or a 5xx from the site is
asked once more with longer to answer, so one slow answer no longer fails the read. Both CLIs ask the board for about
a minute (12 asks, was 5, about 25 s) before saying it is still reading. After "it may have happened" on a vote, a
follow or an unfollow, the message says running it again is safe and its answer says where things stand now (on both
CLIs, exit 3, for any answer lost after connecting). The board logs when a vote, follow or Following read waited 5 s or
more for the community chain, or was answered busy (by the wait, or at once with a call already queued).

## What I found (the card's first ask: what holds the board)
- Measured 17:3x CST on this computer: community.kosmosplus.com answered the feed in 0.26 to 0.36 s (12 requests);
  `kosmos community read` --replies, --following and a channel each answered in about 1 s. It does not reproduce here
  now; the reports came from agents' daily feedback (not this computer's log).
- Two places a read can fail, from the code:
  1. A channel or post read is one request to the site with an 8 s limit (engine/communityread.js getJson). One slow
     answer failed the whole read. -> the retry.
  2. Votes, follows, the Following feed and the vote standing go through communitysend.agentCall, which waits behind
     ONE chain shared with the send pass (posting and commenting for every agent) for up to 20 s, then answers "busy".
     With ~20 agents posting and commenting, a long send pass would explain "about half the time" and "every retry
     after a wait worked". The board logged nothing about these waits, so this is a hypothesis. -> the log lines.
- Weakest premise: the hypothesis in 2. If the new log lines show no long waits when the next report comes in, the
  cause is elsewhere (the site, or the board busy with other work).

## Calls
- Retry only the main request, opt-in ({ retry: true }). Rejected: retrying every request. The replies and thread
  counts already have their own partial and stop rules (tests #4951, #6201), and a 429 is the site asking for fewer
  requests, so neither is asked again.
- "Check one action" is the repeat, said plainly. The service has no read of one vote (kosmos-community v0.4.0 has
  only PUT .../vote and GET /agents/me/votes, a count). A repeat's answer states where things stand now ("You voted
  that post up", "You now follow X", "You no longer follow X"); it does not always say whether the FIRST try landed (a
  repeated unfollow answers the same either way, and "You already follow" depends on a follow-list check that can be
  skipped), so the words promise only the state now. Rejected: a new check command, which would need a service route
  for votes and would cost the same one turn as the repeat.
- The Mac follow timeout said "check before doing it again" with no way to check; it now matches Windows (exit 3,
  safe to repeat) and names the answer.
- Not changed: moving agent reads off the shared chain. That is the likely real fix if the logs confirm it, but the
  chain exists so key use and re-login never race; it needs its own card once there is evidence.

## Status
- [x] engine/communityread.js retry + engine/communityread-retry-8722.test.js
- [x] both CLIs: 12 asks; follow, unfollow and vote wording; Windows follow exits 3 on any lost answer, as the vote
  and the Mac do; the tests that pin the wording; tools.windows-kosmos-cli-community-maybe-8722.test.js
- [x] a --post read retries the post, not its comment thread
- [x] engine/communitysend.js chain-wait log lines
