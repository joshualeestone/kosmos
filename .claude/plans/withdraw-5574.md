# withdraw-5574: `kosmos community withdraw <post|comment> <id>` (kosmos#5574, slice 2a)

## Finished means
An agent can take back its OWN community post or comment from either CLI (Mac `install/kosmos`, Windows
`tools/windows/kosmos-cli.js`) with the id it holds. Queued, it is withheld and never goes; sent, the next sweep
takes it down from the community as that agent. Another agent's id is "not found". The agents' community
instructions tell them how. (Slice 1, the service's PATCH, is kosmos-community#51; slice 2b, `edit`, is next.)

## Decided
- Reuse the owner's removal path (#4287 posts, #4801 comments) rather than a new one: every state it already handles
  (withheld, sending right now, unconfirmed, refused, untraceable, already removed) answers the same way, in words.
- Ids: the service id (what `read` shows) or the board's own id (what the send answered while queued). Ownership is
  the record's `agent` == the token's agent; anything else is "not found", no oracle.
- The route keeps the board-token gate, as service-comment does (a take-back changes what the public sees).
- Instructions: one line after `status`: fix a slip by withdrawing and resending, never a correcting second comment.
- Weakest premise: the owner-removal answers (written for a person's list) read right to an agent. They are plain
  sentences ("This comment has already been removed from the community"), so they should.

## Checks
- engine/communitywithdraw-5574.test.js (5): queued comment withheld (a twin that is not taken back DOES go: the
  control), sent comment taken down by the service id (case-insensitive) as that agent, another agent refused by
  either id with nothing recorded, posts both ways, bad input. Mutation: withdrawFor answering ok without recording
  -> 3 red.
- cli.community-withdraw-5574.test.js (5), tools.windows-kosmos-cli-community-withdraw-5574.test.js (3): same request,
  same words, usage errors send nothing.
- server.agent-token-gate-4491.test.js: refused on an agent token alone; past the gate with the board token.
- tools.windows-kosmos-cli-verbs-parity.test.js: pinned community subcommands include withdraw.
- Every test loading engine/communityblock.js: 470 passed.

## Review 1 (sonnet, blind): 3 WARNING + 3 NIT
- [WARNING] posts: the owner removal (#4287) records a removal in every state, so a refused post, or one whose send got
  no answer, read "Taken back." though nothing would come down --> FIXED: refused, deleted, unconfirmed and sent-without-id
  posts are refused up front in words, nothing recorded; the CLIs' fallback line no longer says "Taken back".
- [WARNING] a removed agent's sent records are renamed retired:..., its board rows are not, so a new agent with the same
  name could reach the old agent's words by board id --> FIXED: a board id counts only when no sent record names
  another owner. Test with a control.
- [WARNING] untested: those post states, cross-kind ids --> FIXED (3 tests). Mutations: post guards removed -> red;
  retired check removed -> red.
- [NIT] a non-retryable read failure maps to 500 --> kept (the delete route does the same).
- [NIT] Retry-After ignored by both CLIs --> kept; the 503 sentence says to try again.
- [NIT] the instruction line: a resend counts toward limits --> FIXED (it says so).

## Review 2 (opus, blind): 2 WARNING + 4 NIT
- [WARNING] a sent post whose agent the community refused would be "taken back" but sweepDeletes skips refused keys,
  so it never comes down --> FIXED: refused, or no live registration, is refused up front in words (keys unreadable:
  retryable 503). Mutation: guard removed -> red.
- [WARNING] review 1's "pending and attempted" post guard was WRONG for posts: a post can be found again
  (settleUnconfirmed/findExisting), so the next sweep takes it down if it arrived or holds it if it did not; the guard
  also caught a post whose POST is out right now --> FIXED: let through; the CLIs say "Kosmos never heard whether this
  post arrived, so on its next send it takes it down if it did, or stops it if it did not". Test flipped.
- [NIT] already taken down read "Nothing was taken back: ..." after a retry --> FIXED: answers ok with state deleted.
- [NIT] sweepDeletes marks a post deleted on a 404 with no registration check (predates this change) --> recorded as a
  follow-up on #5574; withdraw now refuses a post whose registration is gone, which closes the agent-reachable path.
- [NIT] a removed agent's queued item with no sent record is reachable by a same-named new agent --> recorded: recording
  a removal for an item that will never go is harmless.
- [NIT] tests encoded the wrong unconfirmed behaviour --> FIXED with the flip.

## Review 3 (sonnet, blind): 2 WARNING + 3 NIT
- [WARNING] a queued comment retried after the sweep recorded it withheld read "Nothing was taken back" --> FIXED:
  withheld/not_sent answers ok withheld, as a post does. Mutation -> red.
- [WARNING] review 2 let an unanswered post through without the registration check; settleUnconfirmed looks only with a
  live key, so a refused or lost registration would leave it unfound while the agent heard "takes it down if it did"
  --> FIXED: the key check covers sent and unanswered posts. Mutation -> red.
- [NIT] a moderator-removed post would get a DELETE that may never settle --> FIXED: answers ok, already down.
- [NIT] the no-apiKey branch was unpinned --> FIXED (test with a registering entry).
- [NIT] a not_sent post gets the generic "Kosmos recorded it" line --> kept: true, and points to status.

## Review 4 (opus, blind): 1 WARNING + 2 NIT
- [WARNING] a post sent by a registration since REPLACED (not lost) passed the live-key check; the DELETE would go out as
  the new service agent, get a 404 and mark the post deleted while it stays public. Review 2's "closes the
  agent-reachable path" reasoning was wrong for a replaced registration --> FIXED: sendPost now records agentId on the
  write-ahead mark (as sendComment does), so sent and unanswered posts carry it; withdrawFor requires
  sameServiceAgent(rec, k) (agentId, or for an older record a registration no newer than the send). Tests: replaced
  registration refused for sent, unanswered and legacy records, with the sending registration as the control; a real
  sweep records agentId and a new agent's first post can be taken back. Mutations: check removed -> red; agentId not
  recorded -> 2 red. All 40 community test files: 807 passed.
- [NIT] communitySendSoon only on 'sent' (an unanswered one waits for the 5-minute timer) --> kept; "next send" is true.
- [NIT] unreadable comment-deletes.json gives 500, not 503 --> kept; nothing false is said, nothing recorded.

## Review 5 (sonnet, blind): 1 WARNING + 1 NIT
- [WARNING] the registration was checked when the agent asked, not when the sweep sent the DELETE: a re-registration in
  between would 404 and settle "deleted" while public. Pre-existing for the person's own delete; withdraw made it
  agent-reachable --> FIXED: sweepDeletes checks sameServiceAgent at send time, as sweepCommentDeletes does. Test: the
  registration replaced between take-back and sweep sends no DELETE and is not marked removed. Mutation -> red. All
  community test files: 808 passed.
- [NIT] a pending, unattempted post skips the registration check --> correct: it is withheld and never sent.
Reviewer verified the sendPost agentId line changes no other path (aliasing, settle, findExisting, statuses, mine).
