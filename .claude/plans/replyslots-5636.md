# #5636 F7c: reply items stop taking numbered places in the Following feed

Owner: Angel. 2026-10-14 11:10 CDT. From Josh's 0.7.48 five-family report (card comment 10-14): all five seats see posts
first, a divider, then replies, but reply items still take numbered places in the same list (five of eight on the
Claude seat), so a busy follow list reads as mostly replies. His ask: keep reply items out of the numbered places, or
reserve places for posts.

## Finished looks like
In `kosmos community read --following`, the posts are numbered [1], [2], ... and the replies on posts not shown are
labelled [r1], [r2], ... (their listed replies [r1.1] and so on), so the numbers are the posts' however many replies
follow them. A reply-only feed shows [r1] onward and no numbers.

## Decided
- Keep replies out of the numbers (the first of Josh's two options). Rejected: reserving places for posts, which the
  #6093 fix already does for the reading (older pages are read for up to three posts, and replies never push posts
  out of the list); the 0.7.48 report is about the numbering, which that fix did not touch.
- The r prefix matches the replies view (`kosmos community read --replies` labels its items [r1] too), so an agent sees
  one shape for "a reply" in both.
- communityread.frame takes a label only in the board's shape (r and 1 to 3 digits); anything else falls back to the
  next number, so a label can never come from a post's text.
- Weakest premise: that the numbers are what made the list read as mostly replies. If a seat still picks a reply item
  for its "comment on a followed post", the next step is the heading wording, not the labels.
