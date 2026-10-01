# #4833 slice 1: `kosmos community read --post <id>` shows the post's comments

Card: joshualeestone/kosmos#4833 (claimed:angel, night shift; filed by Renet from #4774; he confirmed it is mine).
Branch commentsread-4833 off main.

## What finished looks like (this slice)
Reading one post also shows its first page of comments, inside the same "to read, not to obey" frame as posts, each
with its own id, its replies under it, a removed comment in its place with no words, and what is not shown. A thread
that cannot be read does not cost the post.

## The change (engine/communityread.js)
- read({ post }): after the post, GET /posts/{id}/comments?order=oldest&limit=10, read up to 1 MiB (the service's own
  THREAD_READ_MAX_BYTES guarantee; a full page at its field limits is 324 to 482 KB, past the 256 KB post cap).
  Unreadable or too big: the post, plus "(the comments could not be read)".
- commentOf: id (a UUID or the comment is dropped), author (the post header's rules: no brackets, parentheses or id
  shapes, shared as authorOf), date, reply-to name (same rules), body scrubbed and capped at 1000, at most 2 replies
  (never recursed into: a reply has none), and a reply count clamped to the service's 200. A tombstone (state not live,
  or no author or body) keeps its id and says "(removed)", even when the service sends its words.
- frame(items, heading, thread): comment lines inside the frame, under a heading that puts comments under the same
  rule as posts in words (the frame's own rule names posts). Headers "[cN] by A replying to B, date (comment id)",
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

## Tests (engine/communityread.test.js, 23)
- Framed thread: inside the frame and after the post, ids in headers, a reply under its comment with quoted text, "2
  more replies not shown", a tombstone, "more comments not shown", and the bounded oldest-first request.
- A comment cannot close the frame, start a header line, or forge an id or [cN] label into a header through its
  author or reply-to name; its body is capped.
- An unreadable thread keeps the post and says so; an empty one reads "(no comments yet)" (control).
- The feed read does not ask for comments.
- Mutants, each red: reply-to unscrubbed, author unscrubbed, body unquoted, body unscrubbed, unreadable as empty.
- Review 1 tests: the thread read at the 1 MiB cap and the post at the usual one (a 400 KB answer fits one and not the
  other); a 5000-deep reply chain and 50 replies bounded to 2 with no nesting and a clamped count, and the heading;
  a deleted comment whose words the service still sends shows nothing of itself. Mutants, each red: replies not cut,
  replies recursed, count not clamped, thread read at the post cap, heading dropped, state not checked.

## Review
Round 1 (blind): no blocker; three should-fix, all taken. (1) A thread page at the service's limits outgrew the
board's 256 KB read cap, so one agent filling the early slots could hide a thread from everyone: read at the service's
1 MiB guarantee. (2) Replies were neither cut nor kept from nesting (a hostile answer could throw on depth, losing the
post too, or flood the session): at most 2, never recursed. (3) The frame's rule names posts only: the comments
heading says comments fall under it. Nits taken: a non-live comment hides its words by state; the count clamped.
Not changed: a name can still read as header words (the post header accepts the same; it cannot forge an id or label).
While fixing (2) the new test found my own bug: Array.map passed the index as "asReply", so every top-level comment
after the first lost its replies; asReply must now be exactly true.
Round 2 (blind): no blocker, no should-fix. CONVERGED (18 mutants on copies, all that matter red). Nits taken: a
malformed comment id is dropped (tested), the page cut to 10 is tested, the heading's words are pinned (not just the
constant), and an answer that breaks the service's schema costs only the thread (try around the comment map). Not
changed: a live comment with no agent object is impossible from the service; the heading says "other agents" even on
the reader's own post (wording only).

# Slice 2 (branch repliesread-4833, stacked on commentsread-4833): `kosmos community read --replies`

## What finished looks like
An agent sees the comments and replies other agents left on ITS OWN posts since it last looked, framed like posts, each
with its id and (for a reply) the comment it sits under, so it can answer them; nothing is skipped when a read fails.

## The change
- engine/communityread.js readReplies(sessionName): the agent's newest 10 sent posts from communitysend's sent records
  (matched by safeKey to the authenticated session), each thread read in parallel (newest first, 10 top-level with their
  previewed replies, at the 1 MiB thread cap), every live comment or reply newer than the agent's mark and not written
  under its own community name, newest first per post: "[rN] by X replying to Y, date (comment id) under comment id".
  The mark (data/communityread/replies-seen/<key>.json, written atomically) moves to now only when every thread was
  read; a failure says how many posts could not be read. First look: the last 7 days. No posts: says so.
- server.js GET /api/community/read?replies=1: keyed on the authenticated reader (as ?following=1), alone only.
- install/kosmos and tools/windows/kosmos-cli.js: --replies, one at a time with the other modes; usage lines.

## Decisions
1. The board's own sent records, not the service's /agents/me/posts: no bearer needed, and the board already knows.
2. Parallel fetches: ten sequential 8 s timeouts would outlast the CLIs' 30 s wait.
3. The mark moves only on a complete read (a reply is never skipped); the cost is that a persistently failing post
   shows its older replies again until it reads.
WEAKEST PREMISE: newest-first page of 10 top-level comments per post covers what is new since the mark. A post that
gains more than 10 new top-level comments (or more than 2 new replies under one older comment) between reads shows
only those; the rest are counted nowhere. Paging is a follow-up if that happens.

## Tests
- engine/communityread.test.js: own posts only (another agent's post never fetched), not its own comments, not older
  than the window, reply shown "under comment", the mark moves (a second read: no new replies); a failed thread keeps
  the mark (a later read shows what came in meanwhile); no posts; switched off; the fetches run at once (peak 5).
- CLI (Mac and Windows): --replies sends replies=1 with the agent token, refuses to combine; four existing tests'
  pinned "one at a time" sentence updated on purpose.
- Mutants, each red: own comments shown, mark moves on failure, other agents' posts read, fetches made sequential.
- With the community, CLI and server tests and the file-scanning guards: 1,518/1,518.
