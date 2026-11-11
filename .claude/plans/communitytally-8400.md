# communitytally-8400: one tally of the Following feed, and a reconciliation line in each place

Card: joshualeestone/kosmos#8400 (daily feedback, 2026-11-11). Off main.

## Finished looks like

The nudge, community home and read --following count the Following feed with one function, and each says enough that
an agent can check it saw everything without reading the feed again: home and the nudge say their new posts are the
ones not yet shown (with replies apart), home adds what else the last 24 hours held, and the read says what was counted
before it marked anything seen and where each new post went (shown, behind, not shown). One fixture gives the same
numbers in all three places.

## Decided (also on the card)

Why they differed: home and the nudge already shared communityhome.countedFollowing, but are taken at different times
and a read marks posts seen in between; the read showed every post on the newest page (new or not) and grouped replies
under "Reply to" entries, so its headers counted neither.

- communityhome.tallyFollowing(items, done, now, firstPage) is the one tally: newPosts (countedFollowing), seenPosts
  (last 24 hours, countable id, done), uncounted (last 24 hours, an id no read can record), olderPosts, replies (the
  newest page's from the last 24 hours, one per reply). newPosts + seenPosts + uncounted = every post from the last 24
  hours.
- Home: unchanged count line, plus tallyWords ("Of the P posts in the last 24 hours, N are new, S you have already
  seen, U Kosmos could not count."), only when there is more than the new ones.
- The nudge: "N new posts you have not been shown (and M replies) in the last 24 hours".
- read --following: tallyLine, from the same tally over the items it read (the newest page, then the older pages'
  posts: what home counts), taken before noteSeen: "Kosmos counted, before this read: N new posts and M replies from
  the last 24 hours (and K posts you had already seen or it could not count). This read shows X of the new posts, L
  are behind these, D could not be shown." X + L + D = N.

Rejected: changing what the read shows; counting grouped "Reply to" entries as replies.

Weakest premise: home and the read are two calls on a moving feed, so a post landing between them can still differ by
one; the read's line says "before this read", the moment it counted.

Would change my mind: the person wanting the Following feed to show only new posts.

## Change

- engine/communityhome.js: tallyFollowing, tallyWords; homeFor keeps the tally; homeText and nudgeLine say it.
- engine/communityfollow.js: tallyLine; readFollowing tallies before marking and adds the line above its heading.
- test-support/following-fixture-8400.js: the one fixture. engine/communityhome-5212.test.js (+1, and the nudge
  wording), engine/communityfollow.test.js (+1).

## Results

- communityhome-5212 17 of 17, communityfollow 59 of 59, communityfollow-broaden-7992 passing.
