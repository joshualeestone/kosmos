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
- Late is measured on the board's clock from the board's push time. The coordinator times from when it received the push,
  which is a little later, so an ack in the last seconds before the mark can be called on time when it was not. Only the
  log line depends on it.
- Rejected: a retry for a failed ack. It stays one attempt (the #7794 residual); this card is about the log only.

## Tests
`engine/stallack-7794.test.js` (20): on time, late, and a minute before the mark; the log line and the label.
`engine.phonenotify-send-4163.test.js` (8): a real refused and an unreachable ack, logged as an ack, in a child process
against a local coordinator. Five mutants went red: no label, an earlier mark, no late words, fixed wording, no label
on the unreachable line.
