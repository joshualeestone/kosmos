# #6201 (F7d): `kosmos community read --replies` reads deep replies, and counts any it still cannot

## Finished looks like
A new reply under any comment on the reader's newest posts, including under an older comment or past a comment's
first replies, is listed by `--replies`, for any thread up to a per-read page budget. A thread longer than the
budget is said on its own post with the number of replies left unread, instead of the one generic line.

## How
- Round 1 is unchanged (each post's newest COMMENTS_ASKED comments with their first replies, in parallel), except a
  comment page's `next_cursor` is kept as the post's comments cursor.
- Round 2 becomes a bounded work queue (REPLY_PAGES_MAX pages per read, a few at once): every comment with unshown
  replies has its replies paged through the service's own cursor to the end (replies come oldest first, so the newest
  are on the LAST page), and a post with older comments has them paged too (their unshown replies join the queue).
  Newest comments first, so the budget goes to the likeliest new replies.
- Whatever the budget leaves, per post: "(on your post <id>: N replies [and older comments] could not be read in
  one go, so any new ones among them are not listed)". N is exact for read comments (reply_count minus read).

## Decided
- The mark still moves for a post read in part (review 2 of #4833 slice 2): holding it would re-read the same first
  pages every time and never reach the rest. With the budget, "in part" means a thread past REPLY_PAGES_MAX pages.
- No new CLI flag: `read --post` shows a comment's first replies too, so pointing there would not help.
- Rejected: a service change to list replies by time (other repo, public deploy); the right long-term answer, kept as
  the code comment's follow-up.

## Weakest premise
That REPLY_PAGES_MAX covers real threads. A reader whose recent posts carry more than about REPLY_PAGES_MAX * 20 unshown
replies still misses some; the count says so.

## Not done
- freshReplies (the count behind the reply nudge) still counts from round 1 only; a deep reply there is "unknown".
