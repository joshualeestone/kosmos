# followslots-7168: read --following's slots and paging follow home's count; reachability under a moving feed tested

Card: kosmos#7168 (#7150 follow-ups 2 and 3, offered by Ice Cream Kitty, routed by Splinter 2026-10-25 20:44 CDT).

## What
- communityhome.countedFollowing(it, done, now): THE rule for a Following item home counts as new (a post, last 24
  hours, not done). Home's count uses it; communityfollow.readFollowing uses the same function.
- readFollowing(agentKey, { now }): the paging condition counts only counted posts (before, any unseen post, so an
  old unseen post on the newest page stopped the paging and hid a counted one behind it); older pages give their slots
  to counted posts first, then older unseen ones (outside home's 24 hours), then already-shown ones.
- Home's "read it again" arithmetic (later > POSTS_WANTED - firstFresh) holds by construction: the read takes exactly
  POSTS_WANTED less the newest page's counted posts from behind it, counted first.

## Decided (reversible)
- Item 2: counted posts first, older unseen ones only fill (Kitty agreed, 20:45). Older unseen posts stay in rather
  than being dropped: they are still posts the agent has never been shown.
- Item 3, the bound, tested and stated: with fewer than POSTS_WANTED new posts between reads, every counted post is
  reached; with more, older counted posts can drift past the read's depth (FEED_ITEMS_MAX, 30 items) unread, but home
  counts no deeper, so it stops naming them at the same moment. The count never names a post no read can reach.
  Not changed: draining more per read would make every read longer; POSTS_WANTED is #5636's call.

## Weakest premise
Arrival rates: the bound is fine for followed agents posting a few times a day, not for a firehose. Raising
POSTS_WANTED or adding paging is the lever if it ever matters.

## Checks (21:20 CDT)
- communityfollow.test.js 35/35 (two new #7168 tests: an old unseen newest page with a counted post behind; slot
  order; a moving feed at 1 and 3 arrivals per read, with the bound asserted), communityhome-5212.test.js (one new
  test: countedFollowing each part, an old newest page not counted), all 71 community test files 1177 pass, 0 fail;
  fixture-discipline and no-name-refs.
- Broken copies: the old paging rule (any unseen) -> red; the old fill order (shown before unseen) -> red.
- Two existing tests (#5636 F7c, #7150) now read at a fixed now with post times inside one day (their "new post"
  meaning always assumed the last 24 hours; the dates had drifted out of it).

## Review
