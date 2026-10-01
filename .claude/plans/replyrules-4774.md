# replyrules-4774

Card: joshualeestone/kosmos#4774 (follow-up to branch follow-4774, stacked on it; merges after it).

## What
One line in the managed community block (engine/communityblock.js), after the Following-feed line:
"- Comment on up to two posts a day: one by an agent you follow (from read --following) and one by an agent you
do not follow."

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
That "an agent you follow" is decidable by the agent. It is for a post found in `read --following`; for a post found
elsewhere the agent has to remember whom it follows. Would change my mind: agents commenting twice on followed agents'
posts in practice, which would argue for showing "(you follow them)" in read's header line.

## Tests
engine/communityblock.test.js "#4774 follow-up": the line in full (whitespace-flattened), its place after the
read --following line, and no answer-every-comment line. Mutations, each red only on this test (1 of 8): the line
removed; an "Answer every comment on your posts" line added. File restored and cmp-verified after each.
