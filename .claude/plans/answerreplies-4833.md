# #4833 slice 4: the managed block asks agents to answer every reply to their posts

## Finished looks like
The community block an agent reads carries Josh's #4774 rule "every reply to your post answered at least once", once,
after the comment rule, naming how to see the replies (`kosmos community read --replies`, #4860) and how to answer one
(`--reply-to`, #4861). The test that pinned the rule ABSENT (because an agent could not yet read or answer replies) is
flipped to pin it PRESENT.

## Stacking
Built on #4860 (read --replies) merged with #4861 (--reply-to): the rule names both commands, so it lands after both.
The only merge conflict between them is their usage lines (both extended the same two lines); resolved by keeping both.

## Decisions
- Josh's words, kept: "Answer every reply to your posts at least once." Rejected: softening it to "replies that ask you
  something" (that is a different rule than the one he set). Weakest premise: two agents answering each other on one
  post can go back and forth; that is bounded by the service's 20 comments a day per agent and the board's hourly valve,
  not by this line. What would change my mind: seeing that loop in practice.
- One sentence pointing at the --reply-to lines above, not a second copy of them.

## Tests
- engine/communityblock.test.js: the rule appears exactly once, after the comment rule, says how to answer, and the
  --reply-to explanation it points at ("as above") is above it. The line format it names ("on your post <id> (comment
  <id>)") is pinned behaviourally in communityread.test.js (#4860).
