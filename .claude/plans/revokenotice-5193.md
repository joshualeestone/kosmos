# kosmos#5193: a revoked member is told at once, in one plain sentence

Stacked on heldsend-5192 (#5191 -> #5197 -> #5192 -> this). After Monday, before federation is switched on.

## Problem
1. A member's board learned of a revoke only at its next room-ticket ask, about two minutes later. Until then
   the room looked normal and a post read `placed`.
2. The notice then showed the connector's reason verbatim: "...that connection has been revoked. Ask to be
   re-invited. (HTTP 409 on /v1/mac/federation/room-ticket). To take part again, ask the owner for a new
   code." A raw path, and "ask" twice.

## Call
- A member reads its OWN edge in the edges answer the owner side already uses (`POST /v1/mac/federation/edges`,
  `as_member`; the coordinator lists a revoked edge with `status: 'revoked'`, db.rs FED_EDGE_REVOKED).
  Checked on every post (through `sharedEdges`, so at most one request per EDGE_FRESH_MS for the whole Mac)
  and on every 60 s pass (the pass's one edges request). The shared answer can be up to 15 s old, so a post
  is told on the first post more than 15 s after the revoke, or at the next pass, whichever comes first:
  within about a minute at worst, not two minutes and not always "at once" (round 1).
- Only an edge listed as `revoked` ends the seat. A missing edge or a failed answer changes nothing: a
  partial answer must not lock a member out (the same rule as the owner's revokeCheck).
- Ending is what the connector's own refusal (code 3) does two minutes later: the room is told once, the link
  keeps `ended` across a restart, the status goes to `ended` (held posts go with it, #5192), and the child is
  let go. The connector's later refusal does not tell the room again.
- Lines still in the dying connector's pipe are ignored once the check ends the seat (round 1: a late
  'connected' or 'disconnected' changed the status back, a message was recorded).
- The sentence for a revoke (matched on the connector's own phrase "that connection has been revoked", not
  any "revoked"): "The owner removed this computer from the project. Ask them for a new code to
  join again." Any other ending keeps the old sentence with the reason cleaned: no `(HTTP ...)` trailer and no
  "Ask to be re-invited." (the room's sentence already says what to do).
- One ending sentence per seat, whichever path says it first (the edges check or an earlier 'ended' line);
  reset when the seat connects again, so a later real ending is still told (round 2).
- The reason comes from outside and can be a 64 KB line: only its first 1000 characters are read, cleaned
  first (format characters out, whitespace collapsed), then trimmed, then cut to 200 (round 2: unbounded,
  the patterns stalled the board for up to 5.6 s on hostile input; bounded they take about 0.1 ms).

## Rejected
- Holding a member's post until the edge check answers: it would add a round trip to every post. The cost of
  not holding (round 1, corrected): a post made after a revoke and before the check ends the seat IS carried
  by the relay, which decides from the signed ticket alone until it expires (coordinator fed.rs), so it reaches
  the room. In a sealed room the owner's #5191 check holds and refuses it; in an unsealed room it is shown.
  The member's board shows it as placed and then says the computer was removed. Holding would be the fix for
  the unsealed case and is left for federation's unsealed rooms to decide (sealing is the default since #3728).
- Ending on a missing edge: a coordinator that answered partially would lock members out.
- Rewording in the connector (kosmos-relay): the app owns what the room says, and an older connector would
  still send the old text.

## Weakest premise
That the coordinator keeps a revoked edge in `as_member` with status `revoked` rather than deleting it. True on
relay main (federation_edges_for_member selects every status). If an edge were ever deleted instead, a member
would fall back to the old two-minute path, never to a wrong ending. What would change my mind: a coordinator
change that deletes edges on revoke.

## Cost
A member Mac now makes one edges request per 60 s pass (an owner Mac already did), and at most one per 15 s
while posting, shared across all its rooms.

## Control
engine/fedseats.test.js '#5193': a post after a revoke is told on that post's check, one plain sentence, no HTTP
text, seat ended, link keeps it, connector's later refusal silent, next post refused; late lines from the
pipe change nothing; the pass ends a revoked
member with no post; an active, a missing and an unanswered edge do not end it; another ending is told without
its HTTP trailer, another 'revoked' is not the removal sentence, and a long reason keeps no half trailer. The old 'a seat that ends says why' test now pins the new sentence.
