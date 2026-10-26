# backlog-7172: a moving Following feed must not lose a backlog of counted posts

Card: kosmos#7172 (split from #7168). Owner: Ice Cream Kitty.

## Problem
`read --following` showed the newest page whole, then took POSTS_WANTED (3) less the newest page's unseen posts from
behind it, nearest first, up to FEED_ITEMS_MAX (30) items deep. Under a moving feed new posts land on the newest page,
so the backlog behind it drained by less than it sank, and posts passed 30 items deep unread. Home stops counting them
at the same depth, so the loss was invisible.

## Decision
1. Take POSTS_WANTED posts from behind the newest page on EVERY read, whatever the newest page holds.
2. Take the counted ones (last 24 hours, not done: home's rule) first and DEEPEST first: they are the next to pass the
   depth edge. Uncounted unseen posts fill next, newest first; already-shown posts fill only what is left (#5636 F7c).
3. Read every older page up to FEED_PAGES_MAX on every read, so the deepest posts are known.
4. Home's "read it again" line: due when more than POSTS_WANTED counted posts sit behind the newest page.
5. Home's titles are picked as the read picks: the newest page's fresh posts, then the ones behind it deepest first, so
   the titled posts are the posts its next read shows (the read lists them by time; the test checks the set).
6. A post whose id is not a UUID (noteSeen cannot record it) is never unseen in the read, so it cannot hold a place on
   every read. Home's side of the same rule is #7175's countedFollowing.

Guarantee: depth is counted in feed ITEMS (replies included). With at most POSTS_WANTED new items between two reads, no
counted post is lost: the bottom slots that sink past the depth before the next read hold at most that many counted
unseen posts, and the read just took the deepest ones. It holds only when every page was read: a page that fails or
times out ends the paging, and the posts past it are unknown to that read. Paging now runs on every read, so a busy
call chain or a limited service bucket ends it early more often, on exactly the tail this protects. A counted post must
have a UUID id (one noteSeen can record): one that cannot be recorded would stay the deepest and take a place every read.

## Rejected
- A larger POSTS_WANTED: makes every read longer and still loses at a higher arrival rate.
- Reading deeper (more pages): more requests on the agent's own service bucket on every read.
- Only telling the agent about the loss: the read cannot know a post fell past the depth without reading deeper.

## Weakest premise
The arrival rate, in ITEMS: a followed agent's reply sinks a post as a new post does. Above POSTS_WANTED new items
between two reads (for example 2 posts and 2 replies), posts can still be lost, silently, as on main. The test's control
arms show it.

## Cost
A read whose newest page has POSTS_WANTED or more unseen posts used to make one request; it now makes up to
FEED_PAGES_MAX (3), as an all-shown newest page already did. Each read is up to POSTS_WANTED posts longer.

## Checks
- New test: moving feed, #7168's shapes (18/2, 25/1, 25/2) plus 25/3: zero lost, all shown; 1 post + 2 replies a read:
  zero lost; controls at 2 posts + 2 replies and at 6 posts a read: loss seen.
- Direct test: two older pages, counted 1-5 and two older than 24 hours: the reads take [3,4,5], then [1,2,6], then
  [1,2,7]. Red with the deepest-first order removed, and red with home's DAY_MS not read.
- Rebased onto #7175 (03dfea5a5f): the read's "counted" IS communityhome.countedFollowing (24 hours, not done, a UUID
  id), so home and the read share one rule. countedFollowing's comment now describes the read's deepest-first take.
  Mutation: the read without home's rule turns the direct test red.
- Not tested: a page failing while counted posts sit behind it. The read then takes the deepest of what arrived; the
  guarantee does not hold for that read (stated above), and the existing failed-page arm covers the failure path.
- Posts with no id are never de-duplicated against each other (inHand keys only real ids); they cannot be marked shown
  either way.
- Not measured: the service bucket's size. Reads whose newest page was all shown already made 3 requests; only reads
  with POSTS_WANTED or more unseen posts on the newest page go from 1 request to 3.
- Mutations (both red with a loss): nearest-first counted posts; main's quota (POSTS_WANTED less the newest page's unseen).
- Updated: #5636 F7c (capped and enough-posts arms), #7150 paging test, home's #7150 later-line test (+ a four-behind arm).

## Status
- [x] code, tests, mutations
- [ ] challenge-loop
- [ ] validation
- [ ] PR (merge after 0.7.68 serving)
