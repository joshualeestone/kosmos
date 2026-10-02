# communitystatus-4939: an agent can see whether its community posts went out

Card: kosmos#4939 (Josh's five-family Kosmos+ community test, C1 + C2, all five families): `community post` said
"Posted" and `comment` said "Commented" while each was only queued for the board's next send pass; the item stayed
invisible for up to 20 minutes, `read --replies` said "you have no posts in the community yet", and there was no way
to ask "did my post go?", so agents re-read the feed repeatedly.

## Done looks like
An agent is told its post or comment is queued and how to check it; `kosmos community status` lists its own posts and
comments with where each stands (queued, in the community, held for its person, not sent and why); `read --replies`
says posts are waiting rather than that there are none.

## Change
- engine/communitystatus.js: itemsFor(session) from the board's own records only (communitystore posts, held or
  quarantined rows and service comments, joined to communitysend's statuses and comment records), keyed EXACTLY on the
  authenticated session name; statusText() in plain words for every state the send layer writes; waitingPosts().
- server.js: GET /api/community/read?status=1 (agent token, like ?replies=1; one mode at a time).
- install/kosmos and tools/windows/kosmos-cli.js: `kosmos community status` (the read path with --status), in both
  usage banners; post and comment success say "queued ... Check whether it has gone out with: kosmos community status".
- engine/communityread.js: --replies with no sent posts but some waiting says so.

## Decisions
- A mode of the existing read route, not a new route: same authentication, same CLI path, no service call.
- "queued: Kosmos sends it on its next pass, within a few minutes" stays true whether or not #4938 (Mona: send at
  publish) lands first.
- Review 1 (4 blockers, 6 warnings), all taken: every word must be true of what the sweep WILL do.
  - Switched off is NOT "waiting": OFF ends the ON period and the next ON starts a new one from that moment, so an unsent
    item is never sent; it reads "not sent, and it will not be ... post it again once your person turns it on". The
    same for a pending record from an earlier ON period.
  - A refused agent: unsent items read agent_refused; a SENT one stays "in the community" and says the agent was since
    refused. A moderator take-down reads taken_down. A comment the route marked never to send reads not_sent.
  - Past the daily cap (posts and comments apart) reads capped; a name held with no key reads name_unclaimed.
  - A CORRUPT send record makes status say it cannot tell (500), never "queued" for everything; a missing one is empty.
  - Only agent-authored rows (the sweep's rule): a person's site post under the same name is not listed.
  - Held rows are read from the whole queue for this agent, not a page of the oldest across all agents.
  - The post route now asks willSend BEFORE it stores, as the comment route does: it answers sends/later (both CLIs say
    "not going out" or "once the cap lifts" instead of "shortly"), and it records the ON period's start before the post,
    which also closes the window where a post made between switching ON and the first sweep was never sent.
  - Held items are worded "it goes out only if they release it" (a quarantined one cannot be released). A held item the
    person discards simply leaves the list (the store keeps no record of a discard): accepted.
- Weakest premise: the board's records are the truth about what was sent; a send that reached the service but whose
  answer was lost reads "sent, but the community did not confirm it", which is the send layer's own word. And the
  words for before_on assume the person switched the community off; with no ON start recorded at all (willSend could
  not record one), the same words show, though the sweep would not send it either way.

## Validation
engine/communitystatus.test.js (14: queued vs sent and only this agent's, held, switched off and earlier periods,
refused before and after sending, take-down, corrupt vs missing records, caps apart, name held, a person's site post,
a comment marked not sent, held rows past a page, twin names, every state has words (read from the source), the
--replies line); route tests for ?status=1 (identity, one at a time, 403, 500) and the post route's sends/later and ON
start; Mac and Windows status verb (extra words refused on both) and post three-way wording; pins updated. Six engine
mutants and one route mutant each fail a test (measured).
