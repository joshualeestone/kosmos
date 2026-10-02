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

## Review 1 (Opus, blind): 0 blockers, 5 warnings, 4 nits.
- WARNING (reproduced) FIXED: a reply to the member's OWN post (--in-reply-to, no @) held on the Google quota was kept
  unmarked, so the new stale drop would remove it after 2 h of quota pause. It is now kept marked (asks the member),
  like an @. Test (control: a plain held post stays unmarked) + mutant.
- WARNING (mutation-proven) FIXED: the held line riding a typed arrival had no test. Test with two real posts and a
  loop-guard stop between them: the arrival names the later one, not the earlier. Mutant killed.
- WARNING (mutation-proven) FIXED: flushReleased passing the judge to flushOnIdle had no test. Direct test. Mutant killed.
- WARNING (kept, decided): "the person asked the room to go quiet" by POSTING (an operator post, not a valve stop) is
  not a staleness signal here. An operator post is never held and is typed to every member, and the held line rides
  that arrival (the arrival path takes the held ids), so it is not a separate wake. Weakest premise: a member whose
  typing failed for the operator post keeps its held ids to the next idle flush.
- WARNING FIXED (part) / kept (part): a record write that throws after the members got the post now answers
  unconfirmed ("it reached the room but could not be recorded") instead of throwing "refused" (test with appendFileSync
  failing; mutant killed). The reviewer also noted this branch ENDS an outbox loop: a typing throw on the sync path used
  to make the outbox retry every minute for up to 7 days, typing into the earlier members each time; it now returns
  unconfirmed, which the outbox reads as delivered. Kept for another card: the outbox replaying an old kept post wakes
  everyone (no 2 h rule there).
- NIT FIXED: the stderr line keeps the error's first line, 80 characters (a tmux error can carry the pasted text).
- NIT (kept, stated before): a throw before any paste is unconfirmed too, so an @-ask to that member reads as typed.
- NIT (kept, pre-existing): putBack after a paste-then-throw can tell held ids twice.
- NIT (kept): staleHeld scans the log twice; measured by the reviewer at ~3.6 ms on 200k rows, only when ids are held.
- Mutants this round: 4/4 killed. Related files: 261/261.

## Review 2 (Sonnet, blind): 0 blockers, 2 warnings, 2 nits.
- WARNING FIXED: a post delivered but not recorded had no row, so a re-post was not folded and typed into everyone again.
  Its answer is kept in memory (UNRECORDED_SENDS) for the dedup window and a re-post folds into it. Test + mutant.
- WARNING FIXED: a throw BEFORE the typing path (the hold check, the spill, a lookup) typed nothing but was counted as
  "may have reached". Now a member is unconfirmed only if its typing path was entered; before that it is could_not, and
  a post where that is every member is refused with no row, as before the change. Test + mutant.
- NIT FIXED: the quoted-words pass after delivery is guarded (a throw there no longer surfaces as "refused"). Test +
  mutant (cleanMessage made to throw on an earlier row's text).
- NIT (kept, pre-existing): putBack after a paste-then-throw can tell held ids twice.
- Gap noted again (kept, other card): outbox replay of an old kept post wakes everyone.
