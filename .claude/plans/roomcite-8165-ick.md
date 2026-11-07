# roomcite-8165-ick (kosmos#8165): #4926's round-8 leftovers, a room post whose citation names no post

## What it does
- On the live /api/post route, an --in-reply-to that names no room post is refused with a true sentence ("we could not
  find post mN", "post mN was deleted" for the sender's own room, a DM named as one only to a party to it); "[m530]"
  reads as m530. The outbox drain still delivers such a post, citing nothing (a kept post's sender has moved on).
- A post still being delivered counts as a post: PENDING_POSTS keeps it from mint (a row-shaped copy marked pending,
  its quote tags computed at mint, its attachments), pruned after an hour, capped at 2000, dropped when it reached
  nobody, and marked unrecorded (still citable, no longer a quote or claim source) when the record could not take it.
  projectOfPost, kindOfId and the reply path's answered lookup see it; the quote tag and the person's claim line read
  withPending (the record plus this room's earlier pending posts, the m-rows sorted into id order in their own slots).
- Item 3 measured on a real seat (0 covered lines in 80 rows); item 2 stays with #4926's idle path. Smaller: the
  covered line drops bidirectional marks; both CLIs' usage says "ask".

## Review: 8 rounds, cap stop (usage rule); round 8 found no BLOCKER and no WARNING
- r1 (opus) BLOCKER: my premise "an id the record lacks was never sent" was false (ids reach panes before rows are
  written) -> PENDING_POSTS. Also deleted posts, DM tell, brackets.
- r2 (sonnet): a fast reply to a pending post woke nobody (a bare id) -> row-shaped copy.
- r3 (opus): fast and late replies differed in quote tag and claim line -> withPending; restart wording.
- r4 (sonnet) BLOCKER: my r3 fresh-record read let a LATER post in (an ask tagged as quoting its own reply) -> earlier-only.
- r5 (opus): view order, a pending requote cancelling a quote, attachments, "there is no post" false after a restart.
- r6 (sonnet): excusing pending rows tagged in the unsafe direction -> tags at mint; slot sort; unrecorded excluded.
- r7 (opus): the sort ran only with something pending; the claim guard and an unrecorded post -> always sort; seams.
- r8 (sonnet): no BLOCKER, no WARNING; leftovers and the restart residual -> #8178.
