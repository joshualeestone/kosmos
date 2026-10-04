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

## Review 2 (blind, opus): 1 BLOCKER, 4 WARNINGs, 3 NITs; fixed or answered
- BLOCKER: the votes read went through agentCall, which allows each agent ONE call in flight or queued; a read the
  line gave up on stayed queued up to 45 s, so the agent's next vote or follow (what the line asks for) answered
  "busy". FIXED by dropping the vote count: nothing in the nudge is sent as the agent now (a test asserts no request
  carries the agent's token). The block already names `kosmos community votes`. This also removes the queue cost.
- W1 FLOORS absent everywhere: answered. The names are Renet's (her priority-5211, b3ab1372f, not on main yet);
  until it lands the line uses the two numbers main's block exports (FOLLOW_EVERY_DAYS, POSTS_PER_DAY_MAX).
- W2 a repeat follow could count as new when the "already following" check was skipped, failed or past 100:
  FIXED, communityfollow records a follow as new only when the list was read whole and did not hold the name.
- W3 comments counted replies on the agent's own posts and will-not-go comments: FIXED (own posts from sent.json,
  `notSent` rows skipped; an unreadable sent.json leaves the count out).
- W4 the name got weaker cleaning than community read: FIXED, communityread.authorOf (exported) is used.
- NITs: a failed write removes its temp file; the env read is test-only and cheap; the per-action load is now two
  public reads only.

## Weakest premise (revised)
That two public reads per vote or comment are cheap enough for the service. They are bounded (getJson's 8 s timeout,
the route's 26 s deadline) and run outside every queue; if the service's per-minute limit ever bites, cache the
following list per agent for a minute.

## Review 3 (blind, sonnet): 0 BLOCKERs, 3 WARNINGs
- W1 comments print with no target until FLOORS lands: accepted (honest, never a copied number; Renet's FLOORS ships
  in the same release window, key names checked identical to hers).
- W2 a comment the service refused, or the owner withheld or deleted, still counted: FIXED from comments-sent.json
  (refused, withheld, deleted, not_sent skipped; an unreadable record leaves the count out). A mutant without it
  fails 6 tests. A held comment released later still counts from when it was received (it is public from release);
  accepted, the window is a day.
- W3 two different agents following at the same instant can lose one line of follows-made.jsonl: accepted, the
  count can only run LOW (never a floor shown met that is not), and follows are rare (FOLLOW_PER_HOUR caps each).
- NIT: a comment vote names no author (the service has no public read of one comment); said in the PR.

## Review 4 (blind, opus, final pass): 0 BLOCKERs, 1 WARNING, 2 NITs
- W posts counted posts the service refused, the owner withheld or deleted, or marked never to send (the twin of
  review 3's comment fix): FIXED (sent.json states, deletes.json, the row's notSent; an unreadable record leaves the
  count out). A mutant without it fails 5 tests.
- NITs accepted and stated in the module: follows made before this ships are not counted (one day after upgrade), and
  a first follow whose pre-check was skipped for time is not counted. Both read LOW, never a floor shown met.

## Review 5 (blind, sonnet, aimed at "counts something not public"): 2 BLOCKERs, 1 WARNING; the CLASS closed
- B1 a comment the owner asked to remove (comment-deletes.json, not yet swept) still counted; B2 a post taken down by
  the moderators (sent.json takenDown) still counted; W queued or unconfirmed items counted.
- Reviews 3, 4 and 5 each found another non-public state that counted, because the counts began from "published" and
  subtracted known bad states. REDESIGNED to an allowlist: a post or comment counts only when its send record says
  'sent', it is not taken down, and the owner has not asked to remove it. Any other state, including one added later,
  reads LOW. A mutant without the 'sent' requirement fails 6 tests.
- Residual stated in the code: a COMMENT taken down by the service's moderators still counts (the board records
  takedowns for posts only).
