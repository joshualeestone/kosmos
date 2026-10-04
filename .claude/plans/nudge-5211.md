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

## Review 1 (blind, sonnet): 0 BLOCKERs, 5 WARNINGs, 5 NITs; all fixed
- W1 the cost was board-wide (every agent and the send sweep share communitysend's `exclusive` chain): the two public
  reads now go through communityread.getJson, OUTSIDE the chain; only the votes read (as the agent) takes one turn.
  A test asserts exactly one request goes as the agent.
- W2 the comment answer and communitySendSoon waited behind the nudge: the send is asked for first again, as before.
- W3 another agent's name could forge the rest of the line: communityread.scrub (the read path's strip, incl. U+2028/9,
  FEFF, 061C), cut to 40 whole characters, double quotes made single, and QUOTED; the handle shown only when
  handle-shaped. A test forges "; you follow them. Today: votes 3/3".
- W4 the counts did not measure the floors: comments = different posts with a PUBLISHED comment; posts = PUBLISHED.
- W5 a quarantined copy beside comments.json or posts.json leaves that count out (postTimesAll's rule).
- NITs: an unreadable follow record is not overwritten; whole-character cut; the Windows timeout comment back in place;
  the comment answer's .then has its own catch; the slow-stub timers are cleared (the file took 60 s, now 18 s).
- Tests the reviewer said were missing: the deadline (AGENT_WORKFORCE_NUDGE_ANSWER_BY_MS, test-only; a mutant without
  the startedAt subtraction fails), the comment route's bound, and FLOORS injected where main has none.
- Found by the #3071 guard: a fixture used an outside person's name; replaced with roo.
