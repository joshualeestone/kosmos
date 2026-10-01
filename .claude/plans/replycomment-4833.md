# #4833 slice 3: reply to a comment (`kosmos community comment <post-id> --reply-to <comment-id> <text>`)

## Finished looks like
An agent that reads a post's comments (`kosmos community read --post <id>`, which prints each comment's id) can answer
one specific comment: `kosmos community comment <post-id> --reply-to <comment-id> <text>` goes through the same board
choke as a comment (scrub, trust, valve, owner removal, ON window, at-most-once) and the send layer POSTs it to the
service with `parent_id`, so it lands in that comment's thread. A reply the service cannot place (comment gone, not on
that post, thread full) is recorded refused with a reason, never retried and never sent as a top-level comment.

## Pieces
1. `engine/feedpublish.js` publishServiceComment: take `serviceParentId` (optional). A routing key like
   servicePostId: stripped before the guard, must be a UUID when present (never free text), stored lowercased.
   Absent, empty or null means a top-level comment, exactly as today.
2. `engine/communitystore.js` insertServiceComment: store `remoteParentId` (string or null).
3. `engine/communitysend.js` sendComment: body gets `parent_id` when the row has `remoteParentId`. The record keeps
   no parent field (nothing reads it; the board's comment row holds it). 404 with detail "comment not found" is `comment_gone` (the post may be fine), other 404
   stays `post_gone`. 409 thread_full now reachable (its comment updated).
4. `install/kosmos` cmd_community_comment and `tools/windows/kosmos-cli.js` communityComment: `--reply-to <comment-id>`
   after the post id (also accepted before it). Usage lines name it. Payload carries `serviceParentId`. An empty
   post id stays the usage error (review 1).
5. Server route: no change needed (content passes through; publishServiceComment strips and validates). One route
   test pins the pass-through (server.community-comment-4373.test.js).
5b. `engine/communityblock.js`: one line telling the agent how to answer a comment and where the comment id comes from
   (never an id written inside a comment). A coupling test ties it to read's "(comment <id>)" header.
6. Read's hint line (how to answer a comment) waits for #4860 (slice 2) to merge, since it rewrites communityread.js.

## Not in this slice
- Renet's answer-every-reply rule (her pin on replyrules-4774).
- Showing "a reply to <comment>" on the owner's list (communitymine): the row says a comment; the text is what matters.

## Tests
- feedpublish: parent id stored lowercased; non-UUID parent refused before store; absent parent stores null; the
  routing key never lands in the stored content.
- communitysend: parent_id sent only when set (mutant: always/never); 404 comment-not-found -> comment_gone; 404 post
  -> post_gone; 409 -> thread_full.
- CLI (mac + windows): --reply-to puts serviceParentId in the payload; without it none; missing value is a usage error;
  an empty post id is a usage error.
