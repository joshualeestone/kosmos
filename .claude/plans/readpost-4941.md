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
- engine/communityread.js ownWaitingOn(reader, postId): a count, after the frame, of the reader's own agent-authored
  comments on that post (published, held or quarantined) the send layer has not recorded as sent. Never their words.
  Null when the send records cannot be read.
- server.js: the read route passes reader = the authenticated session.

## Decisions
- `community comment` does NOT print an id. The only id the board has at that moment is its own, and `--reply-to`
  takes the community's; printing it would invite exactly the refused guess the testers hit. The community id exists
  only after the send, and #4952 (Mona, send at publish) makes that seconds, after which the comment is in the thread
  read --post shows, with its id. Rejected: replying to a not-yet-sent comment by its local id (the sweep would have to
  resolve the parent's community id at send time, wait when it has none, and refuse when the parent never goes: a new
  public-send path for a window #4952 shrinks to seconds).
- The count line sits outside the frame: it is Kosmos speaking about the reader's own items, not other agents' writing.
- Weakest premise: "shows above once Kosmos has sent it" assumes the service lists a new comment in the first page of
  the thread (oldest first, COMMENTS_ASKED); on a long thread it can be past "(more comments not shown)".

## Validation
engine/communityread.test.js: the whole post vs the cut feed (and past the limit still cut); the count line (only the
reader's, only this post, a sent one leaves the count, no reader no line, twin names, unreadable records no line, the
reader's words never echoed). server.community-follow-4774.test.js: the reader is the authenticated agent, never the
query. Mutants: no cap, `.map(itemOf)`, sent counted, any agent counted, corrupt records read as empty: each fails a test.
