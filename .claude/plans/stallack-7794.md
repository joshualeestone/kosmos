# stallack-7794 (kosmos#7794, step 1)

A stall pushed to the phone as needs_you is emailed by the coordinator if nobody acks it within 30 minutes
(coordinator notify.rs, NEEDS_YOU_DUE_SECS). A stall that recovered before then was still emailed. The board now acks
the push (POST /v1/mac/notify-ack, #3540) once it is over. No coordinator change.

## Built
- `engine/phonenotify.js` `acked(eventId)`: posts `{installId, eventId}` with the notify token, the id cut exactly as
  `happened()` cut it (CAPS.id, 120 bytes, the coordinator's cap too). Needs only the token and notify id, not the
  switch: someone who turned phone notices off after the push still should not get the email. `noPush()` stops it.
  The body goes through `addressed()`, the one line that names the install field (installid-senders-5995 holds it to one).
- `engine/deliverystreak.js`: `tellStalls` records each sent push as `pushOpen[id] = { at, all, open }`. One push covers
  every agent due in that sweep under the FIRST agent's id, so `acksDue(ends, now)` acks only when every covered agent
  reported an end AND none has a live streak again. A failed push (`untold`) is dropped. Entries older than 6 hours are
  dropped (the coordinator decides the email at 30 minutes and ignores rows older than 6 hours).
- `server.js` minute sweep: `acksDue(stallEnds)` every minute, each id to `phonenotify.acked`.

## Decided
- Ack, not a new `resolved` kind (step 2 on the card): the coordinator path exists, and a new kind needs the phone first.
- Fail toward the email: anything not seen to recover (a stuck turn, a reset, a restart, a failed push) is never acked.

## Weakest premise
An agent covered by the push that has no streak (a stuck turn reported by the card, not the streak map) never reports an
end, so its push is never acked. That is the safe direction (the email goes as before), and it means the ack fires less
often than it could.

## Tests
`engine/stallack-7794.test.js` (8). Five mutants each went red: no wait-for-all (caught by the reset case, since the
still-failing rule also holds the multi-agent case), no failing-again hold, no untold drop, uncut id, unwired sweep.
