# acklog-7802 (kosmos#7802, follow-up to #7794 review round 8)

Stacked on stallack-7794 (PR #7807). Rebase onto main once that merges.

## Built
- `engine/deliverystreak.js` `acksDue` answers `{ id, late }`. `late` is true when the ack goes 30 minutes or more after
  the push (EMAIL_DECIDED_MS, the coordinator's NEEDS_YOU_DUE_SECS): the email may already have gone, though the
  coordinator still answers `matched: true`.
- `engine/phonenotify.js`: `acked(id, { late })` adds ", after its email was decided (it may have gone)" to its log line
  when late. `defaultSend` takes a fifth argument naming the request for its failure lines ("answered N to an ack",
  "could not reach Kosmos+ for an ack"). The default keeps the push's wording exactly ("to a notification", and no
  "for" on the unreachable line), so nothing existing changes. The `acked` doc comment is rewrapped.
- `server.js`: the sweep passes `late` through.

## Decided
- Late is measured from the FIRST push the sender took (review 1): the coordinator keeps the first row of an id and
  decides its email 30 minutes after receiving it, so a retry must not move the mark. If that first push never reached
  the coordinator, a retried ack can be called late when it was not; the words say the email "may have gone". The
  board clock and the coordinator's receive time differ by a few seconds the other way. Only the log line depends on it.
- Rejected: a retry for a failed ack. It stays one attempt (the #7794 residual); this card is about the log only.

## Tests
`engine/stallack-7794.test.js` (22): on time, late, a minute before and exactly at the mark, a retry measured from the
first push; the log line and the label.
`engine.phonenotify-send-4163.test.js` (8): a real refused and an unreachable ack, logged as an ack, in a child process
against a local coordinator. Seven mutants went red: no label, an earlier mark, an exclusive mark, late measured from the retry,
no late words, fixed wording, no label on the unreachable line.
