# replypaging-6204: resume each comment's reply paging where the last read stopped (#6204)

## Problem
`kosmos community read --replies` (since #6201) pages every comment's replies within a budget of 30 pages a read, but
paging restarted from each comment's first cursor on every read and the queue order is fixed, so the same first pages
won the budget each time. The tails of long threads, where new replies sit (the service lists replies oldest first),
were never reached.

## Change (engine/communityread.js)
- Each post's mark keeps `threads`: per comment id the read did not finish, `{ cursor, pos, at, id, waited }`: the
  cursor to go on from, how many replies come before it, the last reply read, and how many reads in a row the thread
  got no page. Checked as read back (`threadsOf`); at most
  THREADS_MAX per post (COMMENTS_ASKED x (1 + REPLY_PAGES_MAX) = 310, the most comments one read can see, so this
  read's places always fit; review 4), this read's threads first.
- Round 2 starts a comment's paging at its saved cursor (`pagingOf`). Replies before it are counted (`readOf`) so the
  "N replies were not reached" numbers stay right.
- Where a thread goes on next time (`placesOf`): a page holding a new reply the 30-cap left unshown is read again; else
  the page still waiting (budget, window or failed page). A thread read to its end keeps NO place and is paged from its
  start next time, as on main (review 1: #5623's owed-person check needs the whole thread in hand, and a finished
  thread kept at its last page never is; a re-check of finished threads also pinned the mark).
- Review 3: threads with a saved place go first in their post's turn, longest-waiting first, and a thread the budget
  never reached is saved at its first cursor, so threads take turns across reads (10 busy posts: none starves).
- Review 3: a saved place whose comment this read did not see (an older-comments page not reached) is kept only while
  the older comments were not all read, and caps the mark like a cut thread; once they were all read, it is dropped.
- Review 3: a replies cursor already read for the comment in this read is not followed (cycles, not only self-loops).
- The post's mark never passes the last reply read in a thread the budget or the window cut (the lowest id at that
  reply's time), so a tail read on a later read is still new.
- A saved cursor the service refuses (4xx, not 429) is dropped and the thread paged from its first cursor.
- A replies cursor naming the page just read is not followed (it would spend the budget and, saved, pin the mark).
- A budget or window cut is said as "not reached in this read; the next read goes on from where this one stopped".
  Failed pages keep #6201's bounded hold (MARK_HOLD_MAX) and wording, and get no cap, so a page that always fails cannot
  pin the mark. A page cut longer than asked keeps the "may be missed" wording.

## Decided
- Older-comments paging still restarts each read (the card names reply paging; older comments go first in each post's
  turn, so they are rarely cut). Said as before ("may be missed").
- freshReplies (the nudge count) is unchanged: it reads only first hidden pages and names only top-level comments.

## Deferred in review
- Iteration 2: a thread a read cannot finish is unknown to #5623's owed check that read (its replies are not all in
  hand). Same as main, where a budget-cut thread was never wholly in hand either; it is checked once a read finishes it.
- Iteration 2: a failed page whose hold is spent (MARK_HOLD_MAX) lets the mark pass its thread, so replies on it may be
  missed when it recovers. Same as main, bounded on purpose by #6201 review 10, and said as "may be missed".

- Iteration 4: while a long thread is cut, the mark is held at its last read reply, so new items shown on that post
  meanwhile wait in "seen". SEEN_MAX (700) overflows only if one post shows more than 700 new items (at most 30 a read,
  so 23 or more reads) while a thread holds its mark, after which an item can be shown twice. Rejected fix: a per-thread
  floor instead of a mark cap (a larger redesign of how "new" is judged). Would change my mind: a busy post measured
  holding its mark that long.
- `threadsOf` refuses a non-id key; a mutation shows that is redundant (such a place matches no comment and is dropped
  at the next write), kept as cheap defence.

## Weakest premise
That the service's replies cursor is a durable keyset position (valid across reads, and still reaching replies added
after it). The feed cursor is (encode_token); the replies cursor is assumed the same. If not, a refused cursor falls
back to paging from the start, and a cursor that silently skips would lose replies: not measured against the live
service.

## Tests (engine/communityread.test.js)
- 8 threads of 6 pages (48 > 30) with new replies at the tails and a newer top-level comment: four reads show every
  tail and the newest comment exactly once; a reply added later to a finished thread is shown once.
- A long thread read to its end: a person's later reply in it is named as owed.
- A read that pages nothing counts the replies before saved places as read.
- A cut page with a waiting page is not told "goes on".
- 10 posts with 6 long threads each: every tail shown once over 40 reads, and no thread waits more than two reads.
- A saved place on an older comment not reached caps the mark (its tail is still shown), and is dropped once the
  comment is gone.
- A cursor cycle A, B, A is read twice and said.
- THREADS_MAX covers one read's comments; spoiled places (bad cursor, pos, at, id, null) are not used, a good one is.
- A changed cursor spelling: every saved place refused, nothing lost.
- A cursor naming its own page: read once, said.
- Mutations (17): no resume, no cap, no refusal restart, no unshown-page place, no waiting place, finished keeps a
  place, cap on failed pages, "goes on" on failed pages, "goes on" on cut pages, cycle followed, no wait order,
  saved-first only, carry always, no carried cap, waited not reset, skipped not counted: each reds a test.
