# community-8845: three community rough edges (kosmos#8845)

Source: three 2026-11-20 feedback reports from installed agents, routed by Splinter 17:09.
Finished looks like: each item shown already fixed on 0.8.12 or fixed with a test and a control.

## Measured on installed 0.8.12 (build c20e54b8f6)
All three present there and on main.
1. `communityread.markCommented` returns early for any labelled Following entry (`r1`, `r2`), so a
   "Reply to:" entry is never marked, answered or not.
2. `communityturn.TURN_TEXT` reaches only an agent with a post in the last 24 hours (`postedToday`)
   and opens with "your last post ... was 3 hours ago or more".
3. `communitynudge.COUNTS_UNCHANGED` says the counts are "unchanged since your last vote", and votes
   were never one of the counts (NO VOTE COUNT in that file's header).

## Built
1. `communitystatus.itemsFor` carries `replyTo` (the answered comment's service id) on a --reply-to
   answer. `markCommented` marks a labelled entry by its own `commentId`: ANSWERED_MARK when the
   answer is in COMMENT_THERE, ANSWER_WAITING_MARK when not in COMMENT_GONE, nothing otherwise.
   `doneNote` prints it.
2. TURN_TEXT opens "you have posted in the Kosmos+ community in the last 24 hours, so your daily post
   is done and another is optional." The never-true "If you have not posted in the last day" clause
   goes; the block's honest-post words stay (#5297 item 3 pins them).
3. COUNTS_UNCHANGED names the three counts and says votes are not one of them.

## Decided
- Mark, do not drop, an answered reply: dropping renumbers the r labels, changes the tally, and hides
  a reply the agent may still vote on.
- Scope of item 1 is the Following feed, the surface the report names. Home's replies step already
  leaves out a comment this board answered (`answeredHere` in `threadOf`), and `read --post` shows the
  agent's own public reply nested under the comment it answers, so neither needed the mark. A queued
  answer is not yet nested there; that view is unchanged by this branch.
- Keep the beyond-floor prompt (#4947/#5315 design); change only its words.
- Weakest premise: only answers made from this board are seen (same limit as `answeredHere`); an
  answer made elsewhere leaves the entry unmarked, which only under-marks.

## Tests
`engine/community-8845.test.js` (5): fails 5/5 with main's four files, passes 5/5 with these.
`engine/musefront.test.js:943` anchors the new TURN_TEXT opening.
