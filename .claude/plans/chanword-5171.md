# #5171 beta day: a post that starts with a channel's name and names no channel is refused, not posted as text

## Measured
- #5222 (`kosmos community post --channel`) is in 0.7.22, the production version: an ancestor of 0.7.22's app commit
  2c39de6ea, read from installkosmos.com's 0.7.22 manifest.
- Still, every one of the 100 community posts is in general (today's 05:30 backup), and agents wrote
  `kosmos community post general "..."`: two such posts on 10-02 (before #5222), and two more on 0.7.22 at 14:36 and
  14:37 UTC today (Angel's beta-day watch). Their instructions predate the channel line, which reaches running agents
  only through #5297 (Angel's), so they guess the shape.

## Change
- engine/communitysend.js leadingChannelWord(text): the channel the post's FIRST whole word names, only as the exact
  lowercase slug (trailing colon or comma allowed), or null.
- server.js POST /api/community/post: with no --channel and no --kosmos-bug, a body whose first word is a
  channel is refused (400) with both ways forward: --channel <it> without the word, or --channel <where it belongs>
  to post the text as written. One place for both CLIs. Refused, never guessed: a real post can start "Research shows".

## Tests
Route: four refused (bare slug, slug with a colon, a sub-channel, and the same mistake with a topic), five controls
(channel named, "Generally", "Security note:", "Testing the new flow", a bug report). Engine: the matcher, including the
parent/sub form, and the non-matches. Mutation: guard off reds the route test.

## Review 1 (sonnet, blind)
- W fixed: case-insensitive matching refused ordinary capitalised openers (thirteen slugs are English words:
  "Security note:", "Testing the new flow"). Now only the exact lowercase slug, the measured mistake (an argument typed
  before the text). Controls added for both openers.
- W fixed: the topic carve-out let `--topic X general "..."`, the same mistake, through. Removed.
- NITs fixed: the refusal no longer doubles the CLIs' "not posted" prefix or their final period (lowercase, no period,
  as the route's other refusals); the comment names what is not caught (markdown or quotes before the word).

## Review 2 (opus, blind): converged (no BLOCKER, WARNING or CONVENTION)
- NIT fixed: the parent/sub form (`engineering/testing "..."`, the shape `community read --channel` shows) is caught
  too, when it names a real channel. NIT fixed: this Tests section was stale after review 1.

## Weakest premise
That refusing is better than routing. An agent that reads the sentence re-runs with --channel; one that does not read it
loses the post. Routing silently would misfile the "Research shows" case instead. The refusal names the exact command.
