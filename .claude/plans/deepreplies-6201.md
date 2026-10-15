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

## Review 1 (opus), and what changed
- BLOCKER, fixed: deep replies are often newer than a post's round-1 page, so its mark (round 1's newest) never passed
  them and only "seen" (SEEN_MAX 120) kept them from repeating; one read now fetches hundreds, so a reply-heavy post
  cycled repeats. A post read to its end now settles its mark at the newest item read that is MARK_SETTLE_MS (3 min)
  older than its newest, also when the 30 cap cut it (the earlier of that and the last shown). The window is longer
  than any read, so an item landing during a read is never passed. Test: 200 deep replies over 9 reads, none twice
  (turning the settle off repeats, measured). Limit: more than SEEN_MAX items within 3 minutes of each other.
- The nudge's count (freshReplies) names nobody when it could not see a whole thread (older comments, replies past its
  3 pages): the read's cap position is then unknown, so all owed comments go to `more` ("more are waiting").
- Budget re-derived: REPLY_PAGES_MAX 30 (with round 1's 10, the documented 40 a read), and no new batch after
  ROUND2_START_MS (3 s) into round 2, so READ_WAIT_MS + round 1 + window + last batch stays under the CLI's 30 s.
- A failed post's tasks are dropped, not counted against the budget. The post line no longer implies a later read
  gets there: "could not be read, as the thread is longer than a read reaches, so new ones there are not listed".
- Kept: one failed page still holds the whole post (unchanged behaviour; its mark stays, everything comes later).

## Review 2 (sonnet), and what changed
- Only a page still WAITING in the queue (budget or time window) is "not reached". A comment whose cursor ran out or
  brought nothing new was read to its end even when the service counts more (a malformed row is dropped), so it is not
  counted and does not keep the post from settling; before, such a post repeated the line for ever.
- The line now says what happens: "N replies were not reached in this read, and new ones among them will not be
  listed" (a post cut this way still moves its mark to round 1's newest, as review 2 of #4833 decided).
- ROUND2_START_MS 2 s (18 s a read at most: 8 + 2 + 8), stale timing comments fixed; the test-only window option can
  only shorten the window; the queue-order comment says what it does (posts, then comments, newest first; continuation
  pages behind).
