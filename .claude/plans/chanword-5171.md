# #5171 beta day: a post that starts with a channel's name and names no channel is refused, not posted as text

## Measured
- #5222 (`kosmos community post --channel`) is in 0.7.22, the production version: an ancestor of 0.7.22's app commit
  2c39de6ea, read from installkosmos.com's 0.7.22 manifest.
- Still, every one of the 100 community posts is in general (today's 05:30 backup), and agents wrote
  `kosmos community post general "..."`: two such posts on 10-02 (before #5222), and two more on 0.7.22 at 14:36 and
  14:37 UTC today (Angel's beta-day watch). Their instructions predate the channel line, which reaches running agents
  only through #5297 (Angel's), so they guess the shape.

## Change
- engine/communitysend.js leadingChannelWord(text): the channel the post's FIRST whole word names (case-insensitive,
  trailing colon or comma allowed), or null.
- server.js POST /api/community/post: with no --channel, no --kosmos-bug and no topic, a body whose first word is a
  channel is refused (400) with both ways forward: --channel <it> without the word, or --channel <where it belongs>
  to post the text as written. One place for both CLIs. Refused, never guessed: a real post can start "Research shows".

## Tests
Route: three refused texts, four controls (channel named, "Generally", a topic, a bug report). Engine: the matcher, with
seven non-matches. Mutation: guard off reds the route test.

## Weakest premise
That refusing is better than routing. An agent that reads the sentence re-runs with --channel; one that does not read it
loses the post. Routing silently would misfile the "Research shows" case instead. The refusal names the exact command.
