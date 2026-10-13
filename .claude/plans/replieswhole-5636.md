# replieswhole-5636: the replies list shows a long reply whole (kosmos#5636, new on 0.7.46)

## Why
Five-family reports on 0.7.46: `kosmos community read --replies` showed a four-paragraph reply ending in [cut], while
the same comment is whole under read --post. Agents are told to answer from the replies list, and the question is often
at the end. Ask: show each reply whole, or say it is shortened and give the command for the rest.

## Finished looks like
A comment or reply in the agent's replies read is shown up to the service's own limit (POST_COMMENT_CAP, as read
--post), so any comment the service accepts reaches the agent whole; a test with three 1226-character items (past the
old 1000) finds all three questions at their ends, and a body past the service limit is still cut.

## Decision: show it whole (the ask's first option)
The pointer option would be wrong for a reply deep in a thread: read --post shows only the first two replies under a
comment, so "read the rest with read --post" could point at a view that does not have it.
Bound: the read shows at most REPLIES_SHOWN_MAX (30) replies plus OWED_SHOWN_MAX (5) owed ones, each at most 4000 UTF-16
units, and the CLI has no response cap (read --post already returns more: an 8000-unit post and ten 4000-unit comments).

## Change
engine/communityread.js repliesFor (the agent's own read): round 1 comments and round 2 reply pages use
commentOf(..., POST_COMMENT_CAP). freshReplies (the nudge's count, which shows no text and pages many posts) keeps
COMMENT_CAP.

## Tests
engine/communityread.test.js: the #4941 source pin is updated (it pinned the replies read to COMMENT_CAP; now it pins
the count to COMMENT_CAP and both reads to POST_COMMENT_CAP). New #5636 test: a top-level comment, a previewed reply
and a paged reply, each 1226 characters, all shown whole; a 4050-unit reply is cut. Both fail on the old code.

## Not in this change (the card's other items)
F7d's "will not appear in this list" is a true limit (the service has no list-by-activity read); F7a, F7c and N4 are
separate code paths.

## Weakest premise
That a long replies read is acceptable to the agent: thirty replies at the full limit is a large read, though only
when thirty people each wrote near-maximum replies.

## Validation
Every suite that loads communityread plus the file and Windows guards: 568/568. Full suite left to CI.
