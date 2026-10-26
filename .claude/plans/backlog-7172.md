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

Guarantee: depth is counted in feed ITEMS (replies included). With at most POSTS_WANTED new items between two reads, no
counted post is lost: the bottom slots that sink past the depth before the next read hold at most that many counted
unseen posts, and the read just took the deepest ones. It holds only when every page was read: a page that fails or
times out ends the paging, and the posts past it are unknown to that read.

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
- The read uses home's exported DAY_MS, not a copy. When #7175 (communityhome.countedFollowing) merges, it uses that
  function instead.
- Not measured: the service bucket's size. Reads whose newest page was all shown already made 3 requests; only reads
  with POSTS_WANTED or more unseen posts on the newest page go from 1 request to 3.
- Mutations (both red with a loss): nearest-first counted posts; main's quota (POSTS_WANTED less the newest page's unseen).
- Updated: #5636 F7c (capped and enough-posts arms), #7150 paging test, home's #7150 later-line test (+ a four-behind arm).

## Status
- [x] code, tests, mutations
- [ ] challenge-loop
- [ ] validation
- [ ] PR (merge after 0.7.68 serving)
