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
  have stored it; an ack for an id it lacks matches nothing); a push the sender did not take opens nothing. A retry
  of a failed push carries the same id and joins the open entry, keeping its time (the coordinator keeps the first row)
  and the agents already seen to recover. An end clears an agent only from pushes made at or before it ended, so the sweep's
  order (ends, then acks, then new pushes) is not load-bearing. Entries
  older than an hour are dropped.
- `server.js` minute sweep (when the roster is not empty): `acksDue(stallEnds)`, each id to `phonenotify.acked`.

## Decided
- Ack, not a new `resolved` kind (step 2 on the card): the coordinator path exists, and a new kind needs the phone first.
- Fail toward the email: anything not seen to recover (a stuck turn, a reset, a restart) is never acked.
- Ack at 25 minutes, not at the recovery (review 1): acking early gains nothing and cannot be undone.

## Weakest premise
That most recoveries end with a landed line. Only those report an end (`note(name, placed)` then `endsToSay`). A streak
cleared by `reset` or `settleFor` (a card whose state speaks for itself) or by `sweep` (the agent left the board), and a
stuck turn reported by the card rather than the streak map, never report one, so their push is never acked and the
email goes as before. Safe, but the ack may fire less often than it could; if that matters, those paths need an end.

## Residuals (all fail toward the email, or narrow)
- The window between the ack (25 minutes, board clock) and the coordinator's decision (30 minutes after it received the
  push, its own clock): an agent that stalls again in it has already been acked. Narrow: a new stall needs STALL_MS and
  STALL_MIN_FAILS before it is one.
- A board asleep past the 30-minute mark acks late: the email has gone. The coordinator still stamps the row and answers
  `matched: true` (it checks only `acked_at`), so `matched` does not mean the email was stopped. A minute whose roster
  is empty asks nothing, and an entry past an hour is dropped.
- An ack is one attempt: the entry is gone once handed to the sender, and a refused or failed ack is not retried.

## Tests
`engine/stallack-7794.test.js` (13). Each rule was mutated and its test went red: wait-for-all (caught by the reset
case, since the still-failing rule also holds the multi-agent case), still-failing hold, the 25-minute window, the
Kosmos+ switch, the test seam clearing pushes (a real restart empties the in-memory map by itself), keeping a failed push, a retry joining it, an end clearing only earlier pushes, a throwing sender opening nothing, not opening an untaken push, the uncut id, the sweep
wiring.
