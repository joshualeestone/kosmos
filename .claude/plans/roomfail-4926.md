# #4926: a room post that landed is told it failed; late held posts wake agents after the room was stopped

## What was wrong (traced in code, 2026-10-01 night)
A. engine/messages.js sendPostWithDelivery: after typing into every member, `if (failed) throw failed.reason` when ANY
   member's typing path threw (not answered could_not: threw). By then the other members had the post; the row was
   not written (appendLog comes after). The route answered 400 {error}, both CLIs print "Kosmos refused that request"
   (exit 1), the agent posts again, and with no row the twin is not folded: every other member gets it twice. The
   synchronous path (outbox drain) threw the same way from the loop.
B. engine/roomhold.js: a post held for a member (not addressed, while it worked) is told by flushOnIdle when the
   member next goes idle, which is a typed line into an idle agent: a wake. Nothing checked the post's age or whether
   the room's loop guard (valve) had stopped the conversation since, so hours later, or after the room was stopped,
   agents were woken into one more short reply.

## Decided
A. A member whose typing THREW is that member's UNCONFIRMED outcome ("may have reached": a throw can come after the
   paste), counted as reached. The row is written; the aggregate is unconfirmed, so the sender is told "do not
   re-post"; a retry folds into the row (agent posts only, as before). Both the async and sync paths. If every member
   threw, the post is still recorded unconfirmed (each may have been typed), never refused.
   Rejected: COULD_NOT for the throwing member (a pasted-then-failed member would be re-sent; and a lone member's throw
   would refuse a post that may have landed). Rejected: keep throwing but write the row first (the CLI would still say
   "refused" and invite the re-post).
B. At the flush (idle flush, the quota flushReleased, and the held line riding a typed arrival), a held post that asks
   nothing of the member is DROPPED (taken, not kept) when it is older than HELD_TELL_MAX_MS (2 h) or the room's loop
   guard stopped the conversation after it (a valve row with stopped !== false, later than the post). A held post that
   names the member and asks for an answer is always told. The post stays in the room (kosmos room shows it).
   Rejected: dropping addressed posts too (an ask must reach its member). Rejected: re-checking at hold time only (the
   stop happens later).

## Weakest premises
- A (throw = maybe typed): a throw before any paste (say a tmux spawn failure that throws rather than answering
  could_not) now reads "unconfirmed, do not re-post" for that member, so it may never get the post. The sender's own
  read of the room shows the row; the alternative was a second copy for everyone else.
- B (2 h): an unaddressed post more than two hours old is not worth a wake. It is a number, not a measurement; the
  report said "hours after".
- B does not cover the OUTBOX drain (a 421-kept post retried up to 7 days, re-stamped at send) or the unanswered nudge
  (#185, addressed operator asks only). Neither was named in the report as the waker; left as they are, noted on the card.

## Not this card (found while tracing)
- A post id is minted from the record before delivery and appended after, with no reservation: two posts in flight at
  once could mint the same mN. Not reproduced. To be filed separately.

## Tests
- engine/messages.typingbroke-4926.test.js (4): reject and throw arms recorded unconfirmed and a retry folds (no member
  typed twice, one row); sync path; every member throwing still recorded.
- engine/messages.fanout-4765.test.js: two tests that pinned the old throw now assert unconfirmed (same timing claims).
- engine/roomhold-stale-4926.test.js (4): staleHeld (age alone, a stop after, not before, not stopped:false, not another
  room, not an unrecorded id); withoutStale keeps addressed; flushOnIdle drops stale and does not keep them; server pin.
- Mutants: 3 (part A) + 7 (part B) all killed. Related files (messages*, roomhold*, outbox*): 257/257.
