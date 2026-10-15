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
  Posts take turns (each post's newest waiting thread, then each post's second, ...; review 7).
- Whatever the budget or window leaves waiting, per post: "(on your post <id>: N replies [and its older comments]
  were past what a read reaches, so new ones among them may be missed (reading again will not reach them))", or,
  while a failed page holds the mark, "... not reached in this read; they will be looked at again next time)". N is reply_count minus read; a lagging count is said as "some replies".

## Decided
- The mark still moves for a post read in part (review 2 of #4833 slice 2): holding it would re-read the same first
  pages every time and never reach the rest. With the budget, "in part" means a thread past REPLY_PAGES_MAX pages.
- No new CLI flag: `read --post` shows a comment's first replies too, so pointing there would not help.
- Rejected: a service change to list replies by time (other repo, public deploy); the right long-term answer, kept as
  the code comment's follow-up.

## Weakest premise
That REPLY_PAGES_MAX (30 pages, 600 replies a read) covers real threads. It does not cover a post with many busy comments
(10 comments of 200 replies need 100 pages). Paging restarts from each comment's first cursor every read and the queue
order is fixed, so the same threads win the budget each time and the tails of the rest (where new replies sit) can be
missed on every read. The post's line says so. Resumable cursors stored with the marks would fix it; not built here.

## Not done
- freshReplies (the count behind the reply nudge) reads round 1 and the first hidden page of its newest
  REPLY_PAGES_PER_POST comments, not the deeper pages; where it cannot see a whole thread it names nobody.

## Review 1 (opus), and what changed
(SUPERSEDED by review 5: the settled mark and MARK_SETTLE_MS described here were removed.)
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
- Kept then (superseded by review 9): one failed page held the whole post.

## Review 2 (sonnet), and what changed
- Only a page still WAITING in the queue (budget or time window) is "not reached". A comment whose cursor ran out or
  brought nothing new was read to its end even when the service counts more (a malformed row is dropped), so it is not
  counted and does not keep the post from settling; before, such a post repeated the line for ever.
- The line now says what happens: "N replies were not reached in this read, and new ones among them will not be
  listed" (a post cut this way still moves its mark to round 1's newest, as review 2 of #4833 decided).
- ROUND2_START_MS 2 s (18 s a read at most: 8 + 2 + 8), stale timing comments fixed; the test-only window option can
  only shorten the window; the queue-order comment says what it does (posts, then comments, newest first; continuation
  pages behind).

## Review 3 (opus), and what changed
(SUPERSEDED by review 5: the settled mark and MARK_SETTLE_MS described here were removed.)
- A post left partly read by the budget also settles: below its newest item by MARK_SETTLE_MS, and no later than the
  earliest last-read item of a comment still waiting (replies come oldest first, so what waits is newer). A post with
  older comments not reached does not settle (their replies can be of any time). Test: 10 comments x 200 replies over
  7 reads, past SEEN_MAX, none twice (switching it off repeats, measured).
- Pages are followed while the service's page had rows at all, not only new valid ones, so a page of malformed rows
  cannot end paging with real replies behind it; a cursor that does not advance is ended by the budget and said.
- The settle window is tested: a deep reply stamped 1 minute before the newest that appears only on the next read is
  shown (MARK_SETTLE_MS 0 fails it). The count's "older comments" uncertainty branch is tested with a control.
- Wording: "may not be listed" (a later read that gets further can still list newer ones).
- Known and kept: round 1's newest item still sets the mark as before this change, so an item that commits late
  inside round 1's own page is as before (#4833's rare late-commit case). REPLY_COUNT_MAX (200, the service's limit)
  means one comment never exceeds 10 pages.

## Review 4 (sonnet), and what changed
- Decided, kept: round 1's newest still moves a partly read post's mark when it is later (#4833 review 2), so a waiting
  thread's tail older than it may be missed. The line now says "may be missed" (not "may not be listed"), and the
  settle comment no longer implies the mark never passes a waiting thread. Starvation stated in the weakest premise.
- The timing comment says the 30 s bound holds for a wait on another agent's read; a wait on the nudge's count
  (FRESH_WAIT_MS, 20 s) can pass it, as before #6201.
- Behaviour change, intended: any post with more than one comments page makes the nudge's count name nobody (all go
  to "more are waiting").
- A waiting page whose comment's count lags is said as "some replies" (untested: the state needs a page to bump the
  count mid-read under budget pressure).

## Review 5 (opus), and what changed: the settled mark is REMOVED
- Review 5 measured repeats again past 7 reads on a post the budget always cuts: paging restarts each read, so a
  partial settle's floor never moved and "seen" (120) overflowed. Reviews 1, 3, 4 and 5 all found defects in the
  settled mark (added in review 1). Decided: remove it, and fix the cause instead. SEEN_MAX is now 700, at least
  everything one read can fetch of one post (30 pages x 20 + round 1's 30), so a mark that cannot move never drops an id
  it can read again; ids read at or below the mark are pruned, and past SEEN_MAX ids this read did not see go first.
  Marks move exactly as before this change. Tests: 200 deep replies over 9 reads and a budget-cut post over 12 reads,
  none twice, 30 new each read (SEEN_MAX 120 fails both, measured).
- A waiting comment's or a cut page's rest is not silently passed: a round-1 or older page longer than asked counts as
  older comments not reached.
- Weakest premise now: that the set of a post's items above its mark stays within SEEN_MAX. One read fetches at most
  630 of a post; ids the next reads cannot see are kept until overflow, then dropped first.

## Review 6 (sonnet)
- Fixed: a replies page longer than asked (the service caps it, so unlikely) is cut at 20 and its rest is said as not
  reached (tested; removing the flag fails it).
- Duplicates of decisions above, kept: tails of threads past the budget can be missed (weakest premise, said on the
  post); one failed page still holds the whole post for that read (unchanged); "seen" could exceed SEEN_MAX only if the
  readable set drifts over many reads of a mark that cannot move (weakest premise of review 5).

## Review 7 (opus)
- Fixed: posts take turns for the page budget (each post's newest waiting thread, then each post's second, ...), so a
  busy newer post cannot starve the older ones (10 posts each get at least 3 pages, as before #6201; tested).
- Fixed: a cursor not in the service's shape is said as older comments not reached, not dropped; dead cursor state
  removed; the freshReplies header says its round 2 is not the read's; a check that could never fail is removed.
- Kept (rare): a person counted as owed when the agent's answer sits on a page the budget cut and the count lagged.

## Review 8 (sonnet)
- No new actionable finding beyond recorded decisions (thread-tail starvation, one failed page holds a post, the nudge
  names nobody on busy posts). Test titles no longer cite review numbers for behaviour later reviews changed; the
  SEEN_MAX comment's bound is stated loosely and truly. Follow-up filed as #6204: resumable per-comment cursors stored
  with the marks, so thread tails are reached over successive reads.

## Review 9 (opus)
- Fixed: a failed round-2 page no longer blacks out the post (30 pages were at risk, not 3): it costs only its thread
  (said as not reached), round 1's items are shown, and the post's mark holds, so what failed comes next time, once.
  Tests: the old failed-page test now expects the post shown with its thread said; a new one shows a reply behind the
  failed page that is older than the post's newest comment still arrives (without the hold it is lost, measured).
- Fixed: a malformed next cursor on a replies page, or a round-1 comment with more replies and no usable cursor, is
  said as not reached rather than dropped. Plan wording brought up to date.

## Review 10 (sonnet)
- Fixed: a page that fails on every read no longer pins the mark: the hold lasts at most MARK_HOLD_MAX (3) reads in a
  row (kept with the mark as `held`), then the mark moves as usual and the failing thread is still said each read
  (tested; an unbounded hold fails it, measured). Stale comments about failures fixed; the SEEN_MAX comment says when
  a repeat is still possible (more than SEEN_MAX ids above one mark).
- Duplicate of recorded decisions: tails lost when a later round-1 comment moves the mark (#6204).

## Review 11 (opus)
- Fixed: the hold count stays at MARK_HOLD_MAX while the post keeps failing (it had cycled 3 reads of 4); six-read test.
- Fixed: the first wave is every post's newest REPLY_PAGES_PER_POST waiting threads in one burst, as before #6201, so a
  slow service that the window cuts after one wave still gives each post what main gave it (tested with a window of 1).
- Fixed: a 429 or an unanswered page stops new waves (the rest is said as not reached); a comment from an older page
  with more replies and no usable cursor, and an empty page that still has a next cursor, are said, not dropped;
  "N or more replies" when a lagging count adds to a counted one; dead failed-post checks removed.
- Each fix has a test that its removal fails (429 ignored, no first wave, cycling hold: measured).

## Review 12 (sonnet)
- Fixed: a post that leaves by an early exit (nothing shown on a cut, no top) still updates its hold count, so a stale
  count cannot shorten a later hold. Comments now say the first wave can be 30 wide (main's burst) and later waves are
  not strictly fair across posts; the marks file can hold about 26 KB of ids per post. The turn test asserts the first
  wave is one burst of at most 30.
- Duplicate of recorded decisions: a repeat is possible only past SEEN_MAX ids above one mark.

## Review 13 (opus)
- Fixed: the first-wave test's window was 1 ms (could lose the first wave on a clock tick); now 10 ms against 30 ms pages.
- Fixed: while a failed page holds the mark, the post's line says the rest "will be looked at again next time"; after
  the hold, "may be missed" (tested both ways). Tests added for a failing older-comments page (said, mark held) and a
  bad cursor on a page with rows (said); removing either branch fails them (measured). Two long comment lines wrapped.
- Decided then, changed in review 16: a 429 or unanswered page stops the waves for every post.
- Kept (rare): a comment whose previewed reply the board drops as malformed reads as one reply not reached, and makes
  the nudge's count name nobody; it needs a malformed row from the service.

## Review 14 (sonnet)
- Fixed: the "will be looked at again" wording only when every part not reached on the post was a failed page; a post
  that also had a budget-cut thread says new ones may be missed (tested; dropping the condition fails it, measured).
- Fixed: the first-wave test's window is 25 ms against 30 ms pages (headroom for a stalled machine).
- Duplicate: a repeat is possible past SEEN_MAX ids above one mark (weakest premise).

## Review 15 (opus)
- Fixed: a budget or window cut recurs (paging restarts each read), so its line no longer implies a later read helps:
  "N replies were past what a read reaches, so new ones among them may be missed (reading again will not reach them)".
  This matters because the reply nudge tells agents to read again until nothing new shows. The held-failure wording is
  unchanged. Tests match either wording where the case is not about it; the exact budget-cut sentence and both hold
  wordings are pinned.

## Review 16 (sonnet)
- Fixed: what a 429 or an unanswered page left waiting is a passing failure: every post with pages still queued holds
  its mark and says the rest "will be looked at again next time" (a bystander post whose next page the 429 stopped is
  tested; without the change it is treated as budget-cut, measured).
- Fixed: older comments cut (a page longer than asked, a bad or empty cursor, or left by the budget) are tracked apart
  from older pages that failed, so a post with both is not promised a re-read. The held count is one rule, written on
  every path.

## Review 17 (opus)
- Fixed: each post's older-comments page is first in its turn, so a burst of new top-level comments (the ones owed an
  answer) is never left behind deep reply threads (4 busy posts tested; queuing it last fails, measured).
- Fixed: after a 429 or unanswered page, only what the budget would still have read is treated as failed (held, "looked
  at again"); the rest is a budget cut. A 429 in round 1 sends no round-2 pages (tested; ignoring it fails, measured).
- Wording: "reading again right away will not reach them" (true for a window cut too). Stale comments fixed (the
  settling remark, the post-line wording in the header, the marks-file shape with `held`).
