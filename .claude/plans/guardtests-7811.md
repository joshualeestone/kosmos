# kosmos#7811 follow-up 3: a test that reaches the own-reply guard

## Problem
PR #7818 keeps the agent's own items read above a mark as "seen" only on a post read whole (engine/communityread.js,
the mark-writing loop: not when the cap held items back, nor with older comments, replies or a failed page left
unread). No test reached the unfinished-thread conditions: removing them all left the suite green.

## Change (test only)
engine/repliesall-7811.test.js: the fake service can fail a replies page; a new test has an older post whose own newest
reply sits on one comment's replies page while another comment's page fails every read. Reads 1 to 3 are taken by the hold;
after read 3 the hold has run out (held 3, and postsToRead no longer takes the post for it alone), and read 4 must
still take it. Removing the guard's unfinished-thread conditions makes it fail.

## Not covered, stated
- Each condition alone: the fixture sets `partial` and `unreadReplies` (one failed page sets both) and never sets
  `olderUnread` or `someUnreached`, so removing any one condition, or the last two together, keeps this test green;
  only removing the unfinished-thread conditions as a set fails it. Telling them apart needs fixtures of their own (a
  budget-cut thread with no failed page, more than REPLY_PAGES_MAX waiting threads; a cut older-comments page).
- The older round's catch: every input it could throw on is validated before it, so no fixture reaches it.
