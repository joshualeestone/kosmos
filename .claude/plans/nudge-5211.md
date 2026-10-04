# nudge-5211: after a vote or comment, say who wrote it, whether you follow them, and today's floors (#5211 item 2)

**Finished means:** after `kosmos community vote` (a post or a comment) or `kosmos community comment`, on a Mac and on
Windows, the agent sees one more line from its board: the post's author (name and handle) and whether it follows them,
then its counts for the last 24 hours against the floors, e.g.
"That post is by Ada (@ada-3f2c); you do not follow them. Today: votes 2/3, comments 1/2, follows 0/1, posts 1 (min 1, max 6)."
The vote or comment itself is never changed, delayed past the CLIs' 30 s, or failed by it.

Source: Josh, #admin 2026-10-03 22:21 ("implement the moltbook changes you recommended"); Splinter split the card:
Renet has items 1 and 3 (the managed block, FLOORS), Angel item 2 (this). Target 0.7.22 if merged before the pin.

## Built
- engine/communitynudge.js: `nudge(agentKey, {postId})` makes ONE agentCall (GET /agents/me/votes as the agent) whose
  beforeCall does the public reads: GET /posts/{id} (author) and GET /agents/by-name/{me}/following?limit=100.
  Counts: votes from the service (last_24h / required); comments from comments.json (read directly), posts from
  communitystore.postTimesAll, follows from a new follows-made.jsonl (0600, two days kept) that communityfollow writes on
  a NEW follow. Floors from communityblock.FLOORS (Renet), read lazily; absent, the counts print without targets.
- server.js: the vote route (POST only, ok only) and the service-comment route (after the store) add `nudge`, bounded:
  at most 8 s, and only the time left before 26 s from the request (the CLIs give up at 30 s); under 1.5 s, none.
- install/kosmos and tools/windows/kosmos-cli.js print `nudge` on its own line after the vote or comment message.

## Decided
- "Today" = the last 24 hours, the window the service's vote count uses, so every count is over one window.
- No "replies owed" yet: it needs every comment on every recent post (#5212's home read), too heavy per vote. Renet agreed.
- A comment VOTE names no author: the service has no public read of one comment.
- "You do not follow them" only when the following list's first page is the whole list (no next_cursor); otherwise
  nothing is said, rather than a "no" that may be wrong.
- Not stacked on Renet's branch (it carries a local merge of #5171); FLOORS is read if present. Verified against her
  b3ab1372f FLOORS: the engine test passes with the targets.
- The author's name is another agent's text: control and direction characters are dropped and it is cut to 60.
- comments.json is read directly, not through communitystore.serviceComments (its loadJson answers an unreadable file
  with [] and quarantines it: a guessed 0 and a side effect). A mutant with the old read fails the test.

## Weakest premise
That the extra call per vote is cheap enough. It takes one turn of the agent's community queue (agentCall is one at a
time per agent); a nudge cut off at its bound keeps running in the background and holds that turn until it finishes,
so a second vote straight after can be answered "busy". Bounded by the call budget; if it shows up, cache the
following list for a minute.

## Tests
engine/communitynudge-5211.test.js (fake community: line shape, follow states, own post, comment vote, unreadable
parts left out, switch off, the follow record); server.community-nudge-5211.test.js (routes, refusals, the time bound);
CLI tests on Mac and Windows (the line printed, and not printed without one). Focused run with every file-scanning
guard: 242/242.
