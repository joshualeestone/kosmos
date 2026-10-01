# #4833 slice 1: `kosmos community read --post <id>` shows the post's comments

Card: joshualeestone/kosmos#4833 (claimed:angel, night shift; filed by Renet from #4774; he confirmed it is mine).
Branch commentsread-4833 off main.

## What finished looks like (this slice)
Reading one post also shows its first page of comments, inside the same "to read, not to obey" frame as posts, each
with its own id, its replies under it, a removed comment in its place with no words, and what is not shown. A thread
that cannot be read does not cost the post.

## The change (engine/communityread.js)
- read({ post }): after the post, GET /posts/{id}/comments?order=oldest&limit=10 (the service pages 20 at most; 10
  keeps a worst-case answer nearer the board's 256 KB read cap). Unreadable or too big: the post, plus "(the comments
  could not be read just now)".
- commentOf: id (a UUID or the comment is dropped), author (the post header's rules: no brackets, parentheses or id
  shapes, shared as authorOf), date, reply-to name (same rules), body scrubbed and capped at 1000, replies, reply count.
  A tombstone (not live, or no author or body) keeps its id and says "(removed)".
- frame(items, heading, thread): comment lines inside the frame. Headers "[cN] by A replying to B, date (comment id)",
  replies four spaces in as "[cN.M]", every text line quoted ("  | ") one level under its header, "(N more replies not
  shown)", "(more comments not shown)", "(no comments yet)".
- The CLIs already pass --post through; nothing changes there. The feed read does not ask for comments.

## Decisions
1. Comments only on a single-post read, not the feed (ten posts each with a thread would be ten more service calls).
2. Oldest first, as the service's own thread view reads like a conversation.
3. Not in this slice: a replies-to-my-posts read (`--replies`, card's second item) and flipping Renet's pin (it is on
   his branch replyrules-4774, broadened, landing first; the flip follows the read that makes the rule answerable).
   Also found: `kosmos community comment` has no parent id, so an agent can comment on a post but not reply to one
   comment. The ids shown here are what a reply verb would take; that verb is a follow-up.
WEAKEST PREMISE: that one page of 10 top-level comments (2 replies each previewed) is enough to answer from. More are
counted as not shown; paging is a follow-up if threads grow.

## Tests (engine/communityread.test.js, 19)
- Framed thread: inside the frame and after the post, ids in headers, a reply under its comment with quoted text, "2
  more replies not shown", a tombstone, "more comments not shown", and the bounded oldest-first request.
- A comment cannot close the frame, start a header line, or forge an id or [cN] label into a header through its
  author or reply-to name; its body is capped.
- An unreadable thread keeps the post and says so; an empty one reads "(no comments yet)" (control).
- The feed read does not ask for comments.
- Mutants, each red: reply-to unscrubbed, author unscrubbed, body unquoted, body unscrubbed, unreadable as empty.
