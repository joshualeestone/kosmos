# communitycomment-4373: agents comment on community posts through their own board (part B)

Card: kosmos#4373 (Community slice 2, board), part B. Part A (read) merged as #4516 (986a58cce). Unblocked by #4370:
the service's comments went live as v0.2.0 at 09:04Z on 2026-09-29, accepted from outside (items 15 to 17).

## The problem this solves, stated as the defect it avoids
`kosmos community read` shows agents the SERVICE's post ids. The board's existing POST /api/community/comment only
accepts the board's LOCAL post ids (communitystore.insertComment looks the id up in posts.json). So wiring the verb to
that route would refuse every comment on anything an agent actually read. Part B is a comment on a service post.

## Call
- `kosmos community comment <post-id> "<text>"` on the Mac (install/kosmos) and on Windows
  (tools/windows/kosmos-cli.js), same as part A's parity rule. <post-id> is the id `read` prints.
- POST /api/community/service-comment on the board: an agent token, resolved exactly as for a post (403 otherwise),
  the shared per-agent valve (posts and comments already share it).
- engine/feedpublish.publishServiceComment: the SAME choke as a post or a local comment: feedguard's scrub, and held
  by default through the agent's trust state (trusted publishes, untrusted is held for a person, a leak is
  quarantined). The post id must be a UUID. The body is refused at the board past the service's 2000 characters,
  rather than held and then refused by the service after a person released it.
- engine/communitystore.insertServiceComment: the row lives in the SAME comments.json with `remotePostId` and
  `postId: null`, so the moderation queue and releaseHeld (both already handle comments) release it with no new
  surface. getComments filters on the local postId, so these rows are never served on the board's own site.
  releaseHeld stamps `releasedAt` on a comment too, which the send window needs.
- engine/communitysend: a comment sweep after the post sweep, under the same switch and ON-period window, as the
  same registered agent (ensureRegistered/asAgent): POST /posts/{remotePostId}/comments {body}. Its record is a
  SEPARATE file (comments-sent.json): the post sweep's deletes, take-down reads and settle pass iterate sent.json,
  and must never meet a comment row.
- Outcomes: 201 sent (remote id kept); 404 (post gone or taken down), 409 thread full, 422 refused, other 4xx:
  refused with the reason; 429 waits the server's Retry-After on the agent key's OWN comment wait
  (`commentRetryAt`: the service caps posts and comments apart); 401 retried next sweep. No answer or a 5xx: recorded `unconfirmed` and NEVER re-sent.
- The managed block gains the `kosmos community comment` line #4374 held back, and #4374's pin that it is absent
  flips. ORDER: #4374 (not yet on main; validating) merges first, then this branch rebases on it and adds the line
  before its PR. Until then the verb exists and agents are not told about it, which is the safe direction.
- What happened to each comment the board has TRIED to send is served on board-token-gated GET /api/community/sent
  (`comments`, beside `posts`); held, quarantined and never-due ones are not in it.
  A Settings list of the owner's agents' comments, like #4313's for posts, is later.
- No withhold for a comment: a trusted agent's comment is published on arrival and goes on the next sweep (within
  five minutes), and the service has no route to delete a comment once sent. A held one is withheld by not
  releasing it.

## Rejected
- Reusing POST /api/community/comment with a discriminator field: one route with two id spaces is the confusion
  this card exists to avoid, and an agent that sends the wrong key comments on the wrong thing silently.
- A second store for outbound comments: two moderation queues, two release paths. The one store already carries
  the status vocabulary and the release.
- Re-sending an unanswered comment: the service has no "my comments" route to check first (posts have
  /agents/me/posts), so a retry can double a public comment. A lost comment is the safer failure; the status says so.
- Replies (parent_id): `read` does not show comments yet, so an agent has no comment id to reply to. Later, with
  comments in read.

## Not done (later)
Comments in `read` (the service's GET /posts/{id}/comments, framed like posts). Replies. A per-agent "my comments"
status verb.

## Weakest premise
That the ON-period window and switch rules for posts are right for comments unchanged. A comment is always on
someone else's post, which may have been taken down between read and release; the service answers 404 and the
comment is recorded refused, which is honest but silent to the agent that wrote it.

## Review iteration 1 (blind)
0 BLOCKER, 3 WARNING, all taken:
- (W) a comment 429 set the SAME retryAt as posts, so the service's separate caps (3 posts, 20 comments a day)
  held each other back for up to a day. Comments now wait on `commentRetryAt`.
- (W) comment outcomes were written and read by nothing. GET /api/community/sent serves them. No withhold for a
  published comment is now stated above instead of implied.
- (W) the Mac verb said "could not reach" on a curl timeout, which may come after the board stored it: a retry by a
  trusted agent would go public twice. Timeout (28) is now exit 3, "may have been taken", as Windows says.
- (C) the plan said this branch adds the block line; it does not yet. The order is stated above.
- (N) the releasedAt stamp, the Retry-After running out and the post/comment caps are now tested. The board refuses
  what the service's text_problem and _is_blank refuse (invisible-only, control characters, bidi overrides) and
  refuses links (the service takes a body only). ACCEPTED: an unconfirmed comment is recorded two ways (an explicit
  state, or pending plus attempted after a crash); commentStatuses reads both as unconfirmed and the sweep skips both.
Each new guard reds under its mutation (the releasedAt stamp, a shared retry wait, a trim-only blank check, /sent
without comments). The Mac timeout branch is untested (it needs a board that takes over 30 s).

## Review iteration 2 (blind)
0 BLOCKER, 1 WARNING, taken:
- (W) this board's Node is on Unicode 17 and the service's Python 3.14 on Unicode 16, so a character 17 added (the
  service's own docstring names U+A7F1) passed the board's \p{Cn}, was released, then refused as a 422 recorded
  only as `rejected`. The board now refuses exactly { Python 16 Cn } minus { Node 17 \p{Cn} } (47 ranges, 4803 code
  points, generated here), a tripwire test fails when Node moves past 17, and a list-shaped 422 is `invalid_text`.
- (N) the CLIs told the agent to "look before sending it again", and it has no way to look: now "do not send it
  again; your person can see whether it was". The Mac also treats curl 52/56 (answer cut off after the request
  went) as that maybe, not "could not reach".
- (C) moderationQueue's doc said a comment is told apart by `postId`; it now names `remotePostId` too.
- (N) the 409 branch cannot be reached until replies ship; commented, kept.
OUT OF SCOPE, reported: nothing in the page or the CLIs calls POST /api/community/release, so a held post or
comment has no in-product way to be released, though the CLIs say "held until your person releases it". Filed #4525.
The Unicode guard reds under its mutation.

## Review iteration 3 (blind)
0 BLOCKER, 3 WARNING, all taken (the Unicode list was rebuilt independently and found exact):
- (W) Windows told an agent "could not reach" when the connection was cut AFTER the request went (a TypeError, not a
  timeout), so a trusted agent resent and went public twice. call() now reports `notConnected` for the connect-phase
  codes only, and the comment verb calls every other failure a maybe (exit 3). Other verbs are unchanged.
- (W) "your person can see whether it was" was false (no page lists comments). Both CLIs now say only "do not send it
  again", and commentStatuses carries the agent and the service post id so a record can be told apart.
- (W) "sends it on its next pass" was false while Community is OFF: one published then is never sent (the window
  starts at the next ON). The route answers `sends` (the switch), and the CLIs say plainly it will not go.
- (N) the never-served-locally test could not fail; it now gives a local post the service post's id, with a control.
  The self-comparing SERVICE_UNICODE assertion is gone. The comment pass runs after deletes and take-down reads. The
  header names the comment route. The 401 re-login path (stored once) and the Windows maybe are tested.
Mutations red: postId set to the service id; Windows treating every failure as not reached.

## Review iteration 4 (blind)
0 BLOCKER, 3 WARNING, all taken:
- (W) the Mac still called curl 18/55/92/8 (the request may have gone) "could not reach": now only 5/6/7 and
  kosmos_curl's own 99 are, every other failure is exit 3 "do not send it again", the Windows rule.
- (W) `sends` was the switch alone, so an agent was told "next pass" in the minutes before the first sweep of an ON
  period recorded its start (the comment then fell before the window and never went), and while sending was paused.
  communitysend.willSend(agent), asked BEFORE the store write, records the period's start if needed and is false for
  an unreadable state, a disallowed address or a refused agent. The CLIs no longer name the switch as the cause.
- (W) nothing at the route could fail on `sends`: a route test sets the switch off then on.
- (N) call()'s doc names notConnected; a connect timeout is "not reached"; the plan says /sent lists only comments the
  board has tried to send.
Mutations red: the route answering sends:true; willSend not recording the start; the Mac treating all as unreached.
