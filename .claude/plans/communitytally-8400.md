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
  (last 24 hours, countable id, done), uncounted (last 24 hours, an id no read can record), olderPosts, replies and
  olderReplies (the newest page's, from and before the last 24 hours, one per reply, counted on the page as read before
  any repeated post is dropped). Posts are counted once each (distinctPosts; a post with no usable id is never a
  repeat). newPosts + seenPosts + uncounted = every post from the last 24 hours.
- Home: unchanged count line, plus tallyWords ("Of the P posts in the last 24 hours, N are new, S you have already
  seen, U Kosmos could not count."), only when there is more than the new ones.
- The nudge: "N new posts you have not been shown in the last 24 hours, plus M replies in that time".
- read --following: tallyLine, from the same tally over the items it read (the newest page, then the older pages'
  posts: what home counts), taken before noteSeen: "Kosmos counted, before this read: M replies (grouped by the
  post they answer; each group shows a few and says how many more) and N new posts from the last 24 hours, S posts you had already seen, U posts Kosmos could not count,
  and O older items from before then. This read shows X of the new posts, L are behind these, D could not be shown."
  X + L + D = N. Cut short, it says "and only in the pages it could read" and "at least" before the posts (replies
  come first because the newest page is always read in full). Taken only when home exports both its rule and its tally.

Rejected: changing what the read shows; counting grouped "Reply to" entries as replies.

Not reconciled, stated: replies are counted the same way in all three places (the newest page's, one per reply, from
the last 24 hours), but the read shows them grouped under posts with "N more replies not shown", so an agent can check
the reply count is the same everywhere but cannot tick replies off one by one. Doing that would change how the read
shows replies, which this card does not ask for.

Weakest premise: home and the read are two calls on a moving feed, so a post landing between them can still differ by
one; the read's line says "before this read", the moment it counted. Second: home takes the newest page as the
first 10 items of its one call; if the service answered the read's first page short with a next cursor, home would
count replies the read treats as page 2 (an existing #7172 assumption, not new here).

Would change my mind: the person wanting the Following feed to show only new posts.

## Change

- engine/communityhome.js: tallyFollowing, tallyWords; homeFor keeps the tally; homeText and nudgeLine say it.
- engine/communityfollow.js: tallyLine; readFollowing tallies before marking and adds the line above its heading.
- test-support/following-fixture-8400.js: the one fixture. engine/communityhome-5212.test.js (+1, and the nudge
  wording), engine/communityfollow.test.js (+1).

## Results

- communityhome-5212 and communityfollow: 79 of 79 after iteration 3's fixes (the focused set grew and was re-run;
  the earlier 84 was a different file set). Each iteration-3 test was shown to fail with its fix reverted, one at a
  time.

## Challenge loop

- Validation 0 passed.
- Iteration 1 (opus): 4 WARNINGs. A cut-short read gave its numbers as exact: FIXED (it says it counted only the pages
  it could read, and "at least"). The fixture fit on one page, so the paths that can differ were untested: FIXED (a
  second fixture, two pages, five new posts behind ten replies: the read says "shows 3 of the new posts, 2 are behind
  these" and home tallies the same items the same), with a cut-short arm. Replies cannot be ticked off one by one:
  DEFERRED, stated above. A tally from a different done set when doneFollowing throws: FIXED (no line then). NITs
  FIXED: readFollowing's docblock back in place, tallyLine's duplicate plural dropped, no "shows 0 of the new posts",
  a literal 4 in the adds-up check.
- Validation 1 passed.
- Iteration 2 (sonnet) and Mona Lisa's outside review (on the card): FIXED: the tally counts distinct posts (a repeated
  post was counted twice) and home's count is the tally's; the read's line splits "already seen" from "could not
  count" as home does, says replies are listed under the posts they answer, counts the older items it prints (every
  printed item is now in the line), and has no "at least" on replies. DEFERRED, stated: the nudge points to home and has
  no reconciliation of its own; nothing marks which printed headers are the new posts (it would change how the feed
  renders); a moving feed can shift a count by one between home's call and the read's.
- Validation 2 passed.
- Iteration 3 (opus): FIXED, each with a test that fails without it: replies were counted after dropping a repeated
  post, so the page edge moved by one and a reply past it counted (now counted on the page as read); home's titles
  came from the undeduped feed, so a repeated post gave two titles (now from distinctPosts); the read's cut-short line
  read "at least N new posts and M replies", as if "at least" covered the replies (replies now come first); the read
  took home's tally even without home's rule (now only with both); two posts with an empty id were merged into one
  (now never a repeat). Tests added for a repeated post across pages, an unusable cursor, and no line when the seen
  list cannot be read. DECIDED, not tested: "D could not be shown" is not reachable today, because entryOf drops an
  entry only when communityread.itemOf gets a non-object, and every counted post is an object of kind post; the arm
  stays as a guard so X + L + D = N holds if that changes. Weakest premise: that itemOf stays that permissive.
- Iteration 4 (sonnet): 1 WARNING FIXED: the line said replies were "listed under the posts they answer", but a post
  lists at most REPLIES_IN_ENTRY (3) of them, so on a busy post the sentence claimed more than the screen shows. It now
  says "shown under the posts they answer, up to 3 a post", tested with four replies on one post (fails on the old
  words). NIT FIXED: "at least 0 new posts" now reads "no new posts". NITs noted, not built: a post with an unreadable
  date is counted among the older items; "Of the 1 post" in home's sentence; the read's older-page key does not trim
  an id as distinctPosts does (only reachable with a non-UUID id, which is uncounted either way); no test puts a seen
  filler post beside a counted one (shownNew filters on the counted ids, so a filler cannot raise it).
- Iteration 5 (opus): 1 WARNING FIXED: "up to 3 a post" was false for replies to a post the feed does not carry (one
  "Reply to:" entry with up to 3 more under it). The line now promises only what both shapes do: "grouped by the post
  they answer; each group shows a few and says how many more", tested for both shapes. NITs FIXED: a cut-short read
  with none says "no new posts in the pages it could read"; a reply repeated on the newest page is counted once, as it
  is shown once. Each fails with its fix reverted. NITs noted: the short-first-page assumption (in the weakest premise
  above); the nudge says "you have not been shown" where the read says "already seen" for the same set (both true).
  Focused: communityfollow and communityhome-5212, 80 of 80.
- Iteration 6 (sonnet): 1 WARNING FIXED: the nudge put the replies inside "you have not been shown", though replies
  are never marked shown; it now says "..., plus M replies in that time". NITs FIXED: a feed of only older posts is
  printed but had no line (it now has one); "it could not count" now names Kosmos, as home does. Each fails with its
  fix reverted. NITs noted: "older items" means the items the read reached (home reads the same depth, so they
  agree); no cut-short test with posts left behind ("at least N are behind these").
