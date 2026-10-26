# followslots-7168: read --following's slots and paging follow home's count; reachability under a moving feed tested

Card: kosmos#7168 (#7150 follow-ups 2 and 3, offered by Ice Cream Kitty, routed by Splinter 2026-10-25 20:44 CDT).

## What shipped (after review round 6 reduced the design; rounds 1 to 6 below are history)
- communityhome.countedFollowing(it, done, now): THE rule for a Following item home counts as new (a post, last 24
  hours, not done; `done` required), exported, used by home's count in place of an inline copy. Its comment states the
  newest-first premise and where the service pins it (kosmos-community tests/test_follows_4774.py
  test_the_feed_pages_posts_and_replies_together_newest_first_each_item_once).
- engine/communityhome-5212.test.js: the rule part by part (age, done in any case, kind, unreadable date, no done set)
  and home's count on a newest-first feed.
- communityfollow.readFollowing and its tests: unchanged from the merge base.

## Decided (reversible)
- Item 2: resolved by the feed's order. On a newest-first feed the counted posts are always the first unseen posts the
  read reaches; it may show older unseen ones beyond the count. The read-side paging and fill changes of rounds 1 to 5
  were reverted: on 2,000 newest-first feeds they behaved exactly like main (round 6).
- Item 3 and done-when 2 (amended by Splinter 22:28, on the card): home never counts a post no read can reach (the same
  30-item depth, FEED_ITEMS_MAX). The backlog a moving feed can lose unread (measured 2 to 11, on main too) is #7172.

## Weakest premise
Arrival rates: the bound is fine for followed agents posting a few times a day, not for a firehose. Raising
POSTS_WANTED or adding paging is the lever if it ever matters.

## Checks at the first build (21:20 CDT, of the design later reverted)
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
- Round 2: 0 blockers, 1 warning, 2 nits. The reviewer ran branch and main on 1,500 random feeds: never fewer unseen
  posts than main, never the same page while unseen posts were reachable, home's read-again line consistent.
  Warning fixed (the cost): any list with fewer than three counted posts fetched all three pages every read (751 of
  1,500 feeds more requests than main). Now the read also stops once three unseen posts are in hand and the last
  page read is newest first with its last item older than 24 hours (nothing counted can be behind it), which keeps a
  quiet list at main's count (tested, with a control; dropping the stop or the order check goes red). A page not in
  newest-first order proves nothing, so the read pages on there. Two tests whose feeds put a counted post behind
  newest-first old ones (which a newest-first feed cannot produce) now use pages out of order, where the guarantee
  still must hold. Weakest premise added: the service feed is keyset newest first (the test backend says so, and
  #5636 F7c paged it as such); if it is not, a page that happens to be ordered could still stop the read early.
  Nits: the header and home comments now say counted where the rule is counted.
- Round 3: 0 blockers, 2 warnings, 2 nits. The reviewer ran 4,000 random feeds and 300 moving ones: on newest-first
  feeds request counts identical to main, never fewer unseen posts, home never quiet over an unshown counted post.
  Fixed: the home test's comment claimed a read reaches the post behind a newest-first old page, which the early stop
  rightly does not; its page is now out of order (the shape communityfollow tests) and the comment says so. The
  quiet-list request count is tested three pages deep, read twice (two requests), and the proof taken from the LAST
  page read is tested (a newest page with a reply from today, page 2 all old): dropping the older unseen posts from
  the count, or not updating the last page, now go red. Nits: an item with no readable date is left out of the order
  check (it can never be counted; tested); the code comment states the newest-first premise itself.
- Round 4: 0 blockers, 1 warning, 4 nits. The reviewer ran 6,000 random and 400 moving feeds against main: never
  worse; newest-first feeds at main's request count; and confirmed the premise from the service itself
  (following_feed pages newest first by created_at then id). Warning fixed: the age half of the early stop had no
  test; a recent, ordered page with a counted post behind it is now tested (removing the age check goes red). Nits:
  the "never relied on the order" comment removed (the early stop does rely on it, as stated); the header block gains
  a #7168 paragraph (what the read pages for, the fill order, the early stop and its premise, the moving-feed bound)
  instead of a sentence spliced into #7150's; DAY_MS_OF became a constant, dayMs, and the communityhome fallback says
  it only pages more, never less; the once-only fill check is tested by its real effect, the slot count (removing it
  goes red; groupByPost folds a twice-added post into one entry anyway).
- Round 5: 0 blockers, 2 warnings, 4 nits. Warning fixed: the comment and this plan promised every counted post is
  reached below three arrivals per read, which the reviewer measured false (it depends on the backlog's size and
  place too; the same on main); both now say only what holds. Warning fixed: the 24-hour threshold of the early
  stop is pinned (a last item 23 hours old pages on, 25 hours old stops; a 12-hour threshold goes red). Nits: the
  undated-item test puts it last, covering which item's age is read (first-item age and not skipping undated items
  both go red); unseenInHandNow counts each post once; the home test's title and comment claim only home's side.
  Not taken: the shown-fill's once-only check (untested on main too, and harmless at three pages).
- Round 6: 0 blockers, 3 warnings, 4 nits, and it changed the design. On 2,000 newest-first feeds (the service's real
  order, confirmed in round 4) the branch showed exactly main's posts with main's request count: a counted post can
  never sit behind an old one there, so the read-side paging and fill changes only differed on unordered pages, which
  the service never sends. DECIDED: keep only the shared rule (communityhome.countedFollowing, used by home's count,
  exported and tested part by part); restore readFollowing and its tests to the merge base. Item 2 resolved by the
  feed's order: counted posts are always the first unseen posts the read reaches; it may show older unseen ones
  beyond the count, never fewer. Item 3: the honest finding is that home never counts a post no read can reach (same
  depth), but under a moving feed a large backlog can be lost unread, on main as on the branch (round 5 and 6
  measured 2 to 11 posts lost at 1 to 2 arrivals per read). The card's done-when 2 ("every post the count names is
  reached") is NOT met as written; changing it is the router's call (asked Splinter).
- Rulings after round 6 (22:28): Splinter amends done-when 2 to the depth guarantee (home never counts a post no read
  can reach, same 30-item depth), merge after 0.7.68 serves, close on that; the backlog loss is filed as its own card
  now, unclaimed, no priority (a post lost unread is invisible, so no agent could report it). Ice Cream Kitty agreed
  and asked for the newest-first premise to be written where countedFollowing lives and guarded: it is, and the guard
  already exists on the service side (kosmos-community tests/test_follows_4774.py
  test_the_feed_pages_posts_and_replies_together_newest_first_each_item_once), now cited in the comment.
- Round 7: 0 blockers, 1 warning, 3 nits: the refactor is behaviour-identical to the inline code and the service claims
  hold. Fixed: the plan's top sections now describe what shipped; "never fewer" reworded (one read takes at most
  POSTS_WANTED from behind; home's read-again line covers more); an uppercase id tested against the done set; the
  rule returns false, never throws, without a done set.
