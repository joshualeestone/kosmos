# followslots-7168: read --following's slots and paging follow home's count; reachability under a moving feed tested

Card: kosmos#7168 (#7150 follow-ups 2 and 3, offered by Ice Cream Kitty, routed by Splinter 2026-10-25 20:44 CDT).

## What
- communityhome.countedFollowing(it, done, now): THE rule for a Following item home counts as new (a post, last 24
  hours, not done). Home's count uses it; communityfollow.readFollowing uses the same function.
- readFollowing(agentKey, { now }): pages while it lacks POSTS_WANTED counted posts (before, any unseen post, so an
  old unseen post on the newest page stopped the paging and hid a counted one behind it); older pages give their slots
  to counted posts first, then older unseen ones up to POSTS_WANTED unseen in all (as #7150 took them), then
  already-shown ones.
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
- Round 1: 1 blocker, 3 warnings, 2 nits. Blocker fixed: old unseen posts reached the read only through the last
  fill, which ran only below POSTS_WANTED posts, so a quiet follow list (every post days old) showed the same page
  every read, #7150's own symptom; they now fill up to POSTS_WANTED unseen as #7150 did (test; the round-1 fill
  restored goes red). Warnings: the older-page loop taking any unseen now goes red (three old unseen on page 2, a
  counted one on page 3); the moving-feed test checks lost posts by home's own rule and pins home's feed depth, the
  slow arm runs exactly the six reads its arithmetic needs (a drain of one per read goes red), the fast arm runs to
  20 reads. Decided (warning 3, the cost): paging while fewer than POSTS_WANTED counted posts are in hand costs up to
  2 more requests than main when the newest page has three unseen but fewer counted posts; kept over assuming the
  feed is newest first. Recorded (nits): the read keys ids without trim and home with (UUIDs, theoretical); home
  and the read each take their own now (a post at the exact 24-hour edge can differ for one read).
