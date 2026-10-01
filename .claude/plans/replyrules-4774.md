# replyrules-4774

Card: joshualeestone/kosmos#4774 (follow-up to branch follow-4774, stacked on it; merges after it).

## What
One line in the managed community block (engine/communityblock.js), after the Following-feed line:
"- Comment on up to two posts a day: one on a post from your Following feed (read --following), not a "Reply to:"
item there, and one on another agent's post that is not in that feed." (worded in reviews 1 and 2, see below)

Josh, on #4774, verbatim: "one of your replies should be to somebody you follow, another reply should be to somebody
you don't follow". The card adds the base cadence of 2 replies a day.

## Decided, not missed
- "Every reply to your post answered at least once" is NOT in the block. An agent cannot read the comments on a post
  today: `kosmos community read` returns posts only (engine/communityread.js itemOf has no comments), although the
  service has GET /posts/{id}/comments. The block's own rule is that a line asking for what an agent cannot do is
  worse than no line. A test pins it absent, so whoever adds the read also has to change that test, on purpose.
  Filed as #4833 (reading a post's comments, and replies to my own posts, through the board).
- No constant for "two": the sentence names both comments, so a number in a constant could drift from the words.
- "Up to" rather than "exactly": the block already says comment only when there is something useful to add, and
  a required count would push agents into empty comments.

## Weakest premise
The wording approximates Josh's "one to an agent you follow, one to an agent you do not" with what the block's own read
shows: a post in the Following feed, and another agent's post not in it. The feed is the newest 10 items, so a followed
agent whose posts dropped out of it counts as "not in that feed", and both comments can go to followed agents. Exact
needs a list of whom the agent follows (no such verb today). Would change my mind: a follow list in read, or agents
seen commenting twice on followed agents.

## Tests
engine/communityblock.test.js "#4774 follow-up": the line in full (whitespace-flattened), its place after the
read --following line, and no answer-every-comment line. Mutations, each red only on this test (1 of 8): the line
removed; an "Answer every comment on your posts" line added. File restored and cmp-verified after each.

## Review 1 (blind, sonnet)
- FIXED (W): "an agent you do not follow" was not checkable: the block gives no list of whom the agent follows, and a
  context reset loses its memory of follows. Both halves now name what the block's own commands show: a post from the
  Following feed, and a post by an agent whose posts are not in that feed.
- FIXED (NIT, my own pattern): the answer-every-comment pin caught only the phrasing first seen. It now catches answer /
  reply / respond to every / each / all comments or replies, in either order, with four control sentences it must see.
  Mutations: a "Reply to each comment on your posts." line reds the pin (the old pin missed it); removing the rule reds.
- Left (NITs): the cap-vs-one-of-each reading of "up to two"; the bullet sits after the follow lines, not beside comment.

## Review 2 (blind, opus)
- FIXED (W): a followed agent's REPLY shows in the Following feed under the PARENT post's id (communityfollow asPost,
  titled "Reply to: ..."), which may be an unfollowed agent's post: those items are now excluded in the wording.
- FIXED (W): "not in that feed" let the agent count its own post; now "another agent's post". The 10-item window is
  recorded above as the weakest premise (round 1 called its rewording a fix; it changed the set, and said so too little).
- FIXED (NITs): the header comment and test title described the old rule; the pin now also catches the quantifier-free
  "Answer the comments on your posts" (6 control sentences). Mutations on THIS text: an "Answer the comments on your
  posts." line reds the pin; removing the rule reds the rule test; file restored and cmp-verified after each.
