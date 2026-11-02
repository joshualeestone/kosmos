# stallack-7794 (kosmos#7794, step 1)

A stall pushed to the phone as needs_you is emailed by the coordinator if nobody acks it within 30 minutes
(coordinator notify.rs, NEEDS_YOU_DUE_SECS). A stall that recovered before then was still emailed. The board now acks
the push (POST /v1/mac/notify-ack, #3540) once it is over. No coordinator change.

## Built
- `engine/phonenotify.js` `acked(eventId)`: posts `{installId, eventId}` with the notify token, the id cut exactly as
  `happened()` cut it (CAPS.id, 120 bytes, the coordinator's cap too). Needs only the token and notify id, not the
  phone switch: someone who turned phone notices off after the push still should not get the email. `noPush()` and the
  Kosmos+ switch (`plusLive`, #6488) stop it.
  The body goes through `addressed()`, the one line that names the install field (installid-senders-5995 holds it to one).
- `engine/deliverystreak.js`: `tellStalls` records each sent push as `pushOpen[id] = { at, all, open }`. One push covers
  every agent due in that sweep under the FIRST agent's id, so `acksDue(ends, now)` acks only when every covered agent
  reported an end AND none has a live streak, and no sooner than 25 minutes after the push: the coordinator reads the
  ack only when it decides the email at 30 minutes, and an ack cannot be taken back, so an agent that recovers and
  stalls again inside that window keeps its email. A push whose answer was a failure stays open (the coordinator may
  have stored it; an ack for an id it lacks matches nothing); a push the sender did not take opens nothing. Entries
  older than an hour are dropped.
- `server.js` minute sweep: `acksDue(stallEnds)` every minute, each id to `phonenotify.acked`.

## Decided
- Ack, not a new `resolved` kind (step 2 on the card): the coordinator path exists, and a new kind needs the phone first.
- Fail toward the email: anything not seen to recover (a stuck turn, a reset, a restart) is never acked.
- Ack at 25 minutes, not at the recovery (review 1): acking early gains nothing and cannot be undone.

## Weakest premise
An agent covered by the push that has no streak (a stuck turn reported by the card, not the streak map) never reports an
end, so its push is never acked. That is the safe direction (the email goes as before), and it means the ack fires less
often than it could.

## Tests
`engine/stallack-7794.test.js` (10). Each rule was mutated and its test went red: wait-for-all (caught by the reset
case, since the still-failing rule also holds the multi-agent case), still-failing hold, the 25-minute window, the
Kosmos+ switch, a restart clearing pushes, keeping a failed push, not opening an untaken push, the uncut id, the sweep
wiring.
