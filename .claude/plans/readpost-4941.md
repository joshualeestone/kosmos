# readpost-4941: read --post shows the whole post, and says when your own comment is not in the community yet

Card: kosmos#4941 (Josh's five-family Kosmos+ community test, 2026-10-01, findings C5 and C6).
C5: `kosmos community read --post <id>` cut the body with "[cut]" at the feed's length.
C6: a reply could not be made on a fresh feed: a new comment appears only once it is sent, and `community comment`
printed no id to `--reply-to`.

## Done looks like
`read --post` shows a post whole (up to the service's own body limit); the feed still cuts. When the reader has
comments on that post that are not in the community yet, `read --post` says how many, and that each shows above with
the id to reply to once Kosmos has sent it.

## Change
- engine/communityread.js: POST_BODY_CAP = 4000 (kosmos-community PostIn's limit) for the one-post read; the feed keeps
  BODY_CAP and maps with an arrow (itemOf now takes a cap, and `.map(itemOf)` would pass the index as one).
- engine/communityread.js ownWaitingOn(reader, postId, more): stacked on #4939, it counts from communitystatus's
  per-item states (each true of what the sweep will do). Comments still on their way (queued, capped, name held) are
  promised a place in the thread, always hedged "perhaps past the comments and replies shown here"; held ones
  (held or quarantined, never told apart) are only counted; sent, unconfirmed, refused, withheld, deleted and
  never-to-send ones are not counted. Nothing is said when an item's records cannot be read. Never the reader's words.
  communitystatus items carry `post` (a comment's community post id).
- server.js: the read route passes reader = the authenticated session.

## Decisions
- `community comment` does NOT print an id. The only id the board has at that moment is its own, and `--reply-to`
  takes the community's; printing it would invite exactly the refused guess the testers hit. The community id exists
  only after the send, and #4952 (Mona, send at publish) makes that seconds, after which the comment is in the thread
  read --post shows, with its id. Rejected: replying to a not-yet-sent comment by its local id (the sweep would have to
  resolve the parent's community id at send time, wait when it has none, and refuse when the parent never goes: a new
  public-send path for a window #4952 shrinks to seconds).
- The count line sits outside the frame: it is Kosmos speaking about the reader's own items, not other agents' writing.
- Review 1 (1 blocker): the first count read only the stored status, so five final states were counted and promised a
  place. Rebuilt on #4939's states (stacked on that branch), with a test of every final state expecting zero.
- Review 2 (2 warnings), taken: the place is always hedged (replies are previewed two at a time, so a short thread can
  hide one too); 'sending' is not counted (its POST is out, so the thread above may already show it) and 'paused' is
  not (read() reads nothing while sending is off). Accepted: no test pins 'sending' out (it exists only while a POST is
  in flight in this process).
- Weakest premise: a comment on its way is not shown above only because the board has not sent it; a comment the
  service already holds but the board recorded as pending (lost answer) is unconfirmed and not counted, so it is
  never counted twice.

## Validation
engine/communityread.test.js: the whole post vs the cut feed (and past the limit still cut); the count line (only the
reader's, only this post, every final state and never-to-send and a refused agent count zero, held promised nothing, a
long thread, no reader no line, twin names, unreadable records no line, the reader's words never echoed). server.community-follow-4774.test.js: the reader is the authenticated agent, never the
query. Mutants: no cap, `.map(itemOf)`, final states counted, any post counted, no long-thread note, held dropped, unreadable
counted: each fails a test.
