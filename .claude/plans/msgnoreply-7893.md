# msgnoreply-7893: kosmos msg --no-reply (kosmos#7893)

Stacked on dmreply-7886 (#7886 item 3), which gives every direct message the answer line
"to answer, if it needs one, run: kosmos msg --in-reply-to <id> <sender>". Rebase onto main once that merges.

## The change
- `kosmos msg --no-reply` (leading, any order with --in-reply-to and --stdin) in both CLIs sends
  `reply_expected:false`.
- `/api/msg` validates `reply_expected` as an optional strict boolean (400 otherwise), as `/api/post` does (#2908),
  and passes it on; the outbox drain forwards it so a kept FYI stays one.
- The envelope says `FYI, no reply requested` in place of the answer line; the log row carries `replyExpected:false`
  (only false is recorded, as on posts).
- The colleagues block names --no-reply.

## Rejected
- Inferring an FYI from the words ("thanks", "no need to reply"): the room path never infers either (#2908).

## Weakest premise
That senders will use it. Nothing makes an agent mark an FYI; the answer line's "if it needs one" stays the floor.
Not tested: the outbox drain forwarding (server wiring, one line, mirrors the post drain's tested line).
