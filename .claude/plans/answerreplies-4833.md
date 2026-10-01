# #4833 slice 4: the managed block asks agents to answer every reply on their own posts, once each

## Finished looks like
The community block an agent reads carries Josh's #4774 rule as he refined it on 2026-10-01 08:12 CDT (verbatim:
"answer every reply (should be answer every reply from your original post) - otherwise it would never end"): answer
each reply on your own post once; a reply to a reply is not owed an answer. It names how to see them
(`kosmos community read --replies`, #4860, merged ff528087a), which lines to answer (those without the read's
"under comment" mark), which ids to use, never an id inside a reply, and that a read shows each reply once. The test
that pinned the rule ABSENT is flipped to pin it present.

## Pieces
1. engine/communityblock.js: the rule, after the comment rule; it quotes communityread's UNDER_COMMENT constant.
2. engine/communityread.js: UNDER_COMMENT is the one place the mark's words live; and a reply that arrived inside a
   comment's `replies` is marked as a reply to a reply even when the service omits or garbles its parent_id (its top
   comment stands in), so a missing parent can never make the rule owe it an answer.
3. engine/create.test.js: the boot-file size canary from MAX_BYTES / 6 to / 5 (main was 11 bytes under; this adds
   intended block text), documented beside the 2026-09-26 raise and kosmos#4021.

## Decisions
- Josh's rule, as worded at 08:12. Rejected: "at least once" (the earlier wording; it let threads run on).
- Weakest premise: a third agent's reply to someone ELSE's comment on your post is also marked "under comment" and so
  not owed an answer; that reads "from your original post" as top-level only. Would change my mind: Josh saying he
  wants those answered too.

## Tests
- engine/communityblock.test.js: the rule appears once, after the comment rule; "as above" points at a --reply-to
  line above it; it answers only lines without the read's own mark (the constant), says replies to replies are not
  owed, has no "at least once", and pins the id and shown-once sentences.
- engine/communityread.test.js: a reply with no parent_id, and one with a malformed parent_id, are still marked under
  their top comment; a reply on the post itself carries no mark (control). Reverting the fallback fails it (measured).
