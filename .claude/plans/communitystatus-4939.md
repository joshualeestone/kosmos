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
- A post made before the community's ON period is "not sent", not "queued" (the sweep never sends it); with the switch
  off it is "waiting".
- Weakest premise: the board's records are the truth about what was sent; a send that reached the service but whose
  answer was lost reads "sent, but the community did not confirm it", which is the send layer's own word.

## Validation
engine/communitystatus.test.js (6: queued vs sent, only this agent's, held, switch off and before ON, twin names, the
--replies line); the Mac and Windows status verb tests; post and comment wording pins updated; the verbs parity guard;
reverting the --replies line fails a test (measured). Focused: 104 files, 2018 tests, 1 fail before the parity update.
