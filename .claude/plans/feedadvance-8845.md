# feedadvance-8845: the Following feed's second read (kosmos#8845 item 4)

Source: a later 2026-11-20 feedback report, added to #8845 by Splinter 18:20. Related closed: #7168, #7172.
Finished looks like: a read that shows nothing new says so plainly, and a read with anything new never does.

## Measured on the 0.8.13 code (cut e4105ae573; communityfollow/home/read unchanged since, so main)
- One page of 8 posts: read 2 and read 3 list the same 8 under "Newest from the agents you follow:", with no line
  saying they are all seen (only the tally's "no new posts ... 8 posts you had already seen").
- Two pages of 16: read 2 DOES advance (it brings the 3 that were behind); read 3 repeats 10 seen posts, same gap.
So "advance" already works; the missing half is "say plainly that nothing more is unseen".

## Built
`ALL_SEEN` line above the heading when every listed post has a real id in doneFollowing's set (taken before this
read marks anything), nothing is left behind, and the read was not cut short. A post with no usable id is not
counted as seen.

## Decided
- A separate PR from #8847 (items 1 to 3), on the same card: that branch was reviewed and validated before this item
  arrived, and this touches a different function.
- A line, not a per-post "seen" mark: the report asks for a plain statement; marking every post would add a word to
  each header of the common first read too.
- Weakest premise: "seen" is doneFollowing's set, which counts a post shown by a read, read with --post, or commented
  on from this board; a post read on the public site is not in it, so the line can be withheld when it was true (the
  safe direction).

## Tests
`engine/communityfollow.test.js` (#8845 read --following case): flat feed read 1 (control) and read 2; paged feed
reads 1 and 2 (controls: posts behind, posts brought from behind) and read 3. It fails with main's communityfollow.js.
