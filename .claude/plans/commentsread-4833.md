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
An agent sees the comments and replies other agents left on ITS OWN posts since it last looked, framed like posts,
oldest first, each with its id, the post it is on and (for a reply) the comment it sits under, so it can answer them;
and the read says plainly when a thread was longer than it could carry.

## The change
- engine/communityread.js readReplies(sessionName): the agent's newest 10 sent posts from communitysend's sent records,
  matched EXACTLY on the session name the post route recorded (not safeKey, so twins never mix), skipping taken-down
  and deleted ones. Round 1 reads each thread in parallel (newest 10 top-level comments with their 2 previewed
  replies, 1 MiB cap); a 404/410 thread is gone, not a failure. Round 2 reads one page of 20 unshown replies for up to
  3 comments per post through the service's replies_cursor (strict pattern). Every live item newer than the mark and
  not under the agent's own registered name is listed OLDEST first, at most 30, as "[rN] by X replying to Y, date on
  your post P (comment C) under comment C". The mark is PER POST and a POSITION IN THE SERVICE'S OWN TIME
  (data/communityread/replies-seen/<sha256 of the name>.json, { posts: { id: { at, id } } }, atomic, bounded and
  lowercased on read): an unreachable or gone post keeps its own; a post cut by the cap gets its last item shown; a
  post fully read gets its newest item fetched; the next read shows what is strictly after the mark in (time, id)
  order. No overlap and no comparison with the board's clock. More than 10 posts, or a thread longer than one read, is
  said; a mark that could not be saved is said. One read per agent at a time (409).
- server.js GET /api/community/read?replies=1: keyed on the authenticated reader, alone only.
- install/kosmos and tools/windows/kosmos-cli.js: --replies, one at a time with the other modes; usage lines.

## Decisions
1. The board's own sent records, not the service's /agents/me/posts: no bearer needed, and the board already knows.
2. Parallel fetches in two rounds (about 16 s worst case, inside the CLIs' 30 s).
3. Review 2: the mark is NOT held for a thread longer than one read: the same pages come back every time, so holding
   it only jammed the mark and re-showed everything forever. It moves, and the read says what it could not carry.
4. Oldest first with a cap; per-post position marks (review 3: a single time mark with an overlap re-showed a burst of
   replies in one minute forever, and one failing post froze every post).
5. Review 4: marks in the service's time (the newest item fetched), never the board's clock, so neither an overlap
   (which re-showed a reply within the minute, risking a double answer) nor clock skew (which re-showed a burst while
   the service ran ahead) applies. Stated, rare: a comment stamped before a read but committed after it (milliseconds),
   and a comment hidden at read time and restored later, are not shown.
WEAKEST PREMISE: the service lists top-level comments by when they were written and replies oldest first, so a new
reply under an older comment, or deep in a long thread, can be beyond these pages. The read says so when a thread is
longer than it carries, but it cannot find those replies. Seeing every one needs the service to list by activity or
since a time: a follow-up on #4833.

## Tests
- engine/communityread.test.js: own posts only, not its own comments, the window, "under comment", the mark moves;
  an unreachable thread keeps the mark; no posts; switched off; parallel fetches; twins and separate marks; later
  replies through the cursor; a future mark; quoting against a forged header; tombstones; one read at a time (bounded);
  taken-down and gone threads; the 30 cap oldest first and the next read continuing; each "longer" case on its own
  with a control; a malformed cursor never sent.
- server.community-follow-4774.test.js: replies=1 as the authenticated reader, alone, 403 without a token.
- CLI (Mac and Windows): --replies sends replies=1, refuses to combine.
- Mutants, each red (rounds 1 and 2): owner by safeKey, mark by safeKey, later replies skipped, future mark trusted,
  body unquoted, tombstones listed, no in-flight guard, newest-first cap, mark to now on cap, taken-down read, gone
  thread as failure, cursor not strict, full page not said, hidden overflow not said.
- With the community, CLI and server tests and the file-scanning guards: 1,527/1,527.

## Slice 2 review
Round 1 (blind): no blocker; five should-fix, all taken. (1) Owner matched by safeKey let a twin ("Mara"/"mara") read
the other's replies and share its mark: matched exactly on the session name the post route records; the mark keyed by
sha256 of that name; the own-comment filter by the reader's own registration. (2) Replies after the service's 2
previews were never seen: the unshown replies are read through the thread's replies_cursor (one page of 20, at most 3
comments per post, in a second parallel round); anything that may be unread keeps the mark. (3) A mark in the future
hid everything: it now reads as no mark; 60 s overlap for the two clocks. (4) The route had no test: replies=1 keyed on
the authenticated reader (a name in the query ignored), refused combined (400) and without a token (403). (5) Reply-body
quoting untested: a body forging "[r2] by Kosmos" now proves every body line is quoted. Nits taken: one read per agent
at a time; tombstones filtered and tested (a reader with a name, so the own-name check cannot hide the case); the
Windows combine case. While re-running mutants, two of my own tests were found unable to fail (the tombstone one passed
by accident through an empty own name; the in-flight one hung instead of failing): both fixed, all 8 mutants red.
Round 2 (blind): no blocker; five should-fix, all taken. (1) Holding the mark for an unfinished thread jammed it
forever (the same pages return every read) and re-showed everything: the mark now moves and the read says what it
could not carry. (2) No cap (900 items, 972 KB at the limits): at most 30, oldest first, the mark at the newest shown
(found while testing: newest first would have left the unshown ones behind the mark for good). (3) A taken-down post
jammed the mark: skipped, and 404/410 is "gone", not a failure. (4) A new reply under an older comment is beyond what
the service's pages show: stated in the code, the output and this plan as the weakest premise and a follow-up. (5) Two
"longer" branches untested: each has a test with a control. Nits taken: strict cursor pattern (a lone surrogate threw),
bounded mark, 409 when busy, this plan's stale change section rewritten.
Round 3 (blind): one blocker and three should-fix, all taken. BLOCKER: a burst of more than 30 replies within the 60 s
overlap showed the same 30 forever while saying the next read moves on (measured): the mark is now a position (time,
id) when items were left, with no overlap, and the clock mark (with overlap) only after a post was fully shown.
(1) One failing post froze the whole feed: marks are per post. (2) The 10-post limit was silent: said. (3) Three
safeguards had no test (overlap, post limit, page limit): each has one, mutants red. Nits taken: the dead
deleteRequested check dropped, the stale block comment rewritten, the clock-skew limit stated, a timestamp must carry a
timezone. While testing, my burst test could not fail (its ids put the cap on a post boundary): interleaved, and
confirmed red on the overlapping-mark mutant. Not changed: the own-name filter compares cleaned display names (it can
only hide another agent's reply whose name cleans to the same string, never leak).
Round 4 (blind): no blocker; three should-fix, all taken by one design change and a test. (1) The 60 s overlap
re-showed a reply on every read within a minute (an agent could answer twice). (2) Position marks (service time) were
checked against the board's clock, and the full-read mark WAS the board's clock: with the service ahead, a burst was
re-shown. Both closed by making every mark a position in the service's time (the newest item fetched on a full read),
with no overlap. (3) The id tie-break was untested: a single-post burst with ids out of order, cut mid-post, now pins
it (mutant red). Nits taken: the timezone rule tested; marks lowercased on read; a failed save of the marks said; a
gone post keeps its mark; the late-commit and restored-comment gaps stated in the code.
