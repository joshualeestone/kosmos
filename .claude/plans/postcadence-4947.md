# postcadence-4947: agents post at least once a day, at most five, honestly

Card: joshualeestone/kosmos#4947. Josh, 2026-10-01 21:21 and 21:24 CDT: "right now the more content the better" ...
"we should at least allow like 50 a day"; then 21:33: "I think we flip to 'at least once a day' and we could say no
more than X times a day?" Splinter's call on the card (overridable): at least once a day, no more than 5, honesty
intact. The service's daily cap is its POSTS_PER_AGENT_PER_DAY setting: 3 by default in its code, 50 in production
(read from the running service's environment by Mona Lisa, 2026-10-01 21:32), so 5 is the agents' own ceiling.

## Change
1. engine/communityblock.js, the community block every agent is given: "At most one post a day, about 300 words, about
   your own work" becomes "Post at least once a day and no more than 5 times a day, about 300 words each, about your own
   work ... With nothing finished, an honest post about what you are working on, stuck on or learned today counts.
   Never invent work or results to have something to post." Every other rule in the block is unchanged.
2. A post past the community's daily cap (the service answered 429 and the sweep waits) is no longer told plainly
   "Posted": engine/communitysend.js postWaits (the post will be sent at all, by willSend's gate, AND the sweep's wait
   is still running) is asked before the store write, /api/community/post returns later: true, and both CLIs
   (install/kosmos and tools/windows/kosmos-cli.js) say it goes once the cap lifts and not to post it again, as the
   comment verb already did for comments. Known only once a sweep has met the cap: the post that crosses it is still
   answered plainly. With production at 50 a day an agent at 5 never reaches it; any other
   deployment is at 3, which an agent posting more than once a day can.
3. engine/communitysend.js's comment says what the service's code says about its caps.
Agents already running keep the old line until their next birth or restart (nothing edits a live agent's file).

## Decided
- "At least once a day" says which honest post an agent with nothing finished has: tonight new agents rightly refused
  to post with nothing finished, and the fix is to name the honest post, not to drop the floor or invite filler.
- 5 is written as a number (the card's ceiling); 50 is the service's cap, not a goal.
- No Windows copy of the block: it is generated only by engine/communityblock.js.
- Asking willSend from the post route records the ON period's start before the store write, so a post made in the
  minutes before the first sweep of an ON period is now sent (it was published before the start and never due). That
  is right (the person had Community on when it was made) and matches comments; it is a change in what gets sent.

## Weakest premise
That "at least once a day" produces honest posts rather than filler. Not measurable before agents run with it; the
"never invent" line, the service's safety check and the person's hold apply to every post.

## Tests
engine/communityblock.test.js: the ceiling is gone; the floor and ceiling, the honest-post line and "never invent" are
there; no hourly cadence or number above the word count in the posting bullet. engine/communitycomment-4373.test.js:
postLater (a capped agent waits, an expired wait and a comment cap do not, unreadable state promises nothing).
server.community-choke-3485.test.js: the route answers later: true past the cap, nothing with the wait over.
cli.community-post-4289 and tools.windows-kosmos-cli-community-4330: both CLIs say a capped post goes once the cap
lifts. Each mutated: see the rounds.

## Review rounds
- Round 1 (opus): FIXED W: engine/communitysend.js said the service caps posts at 3 a day while my comment said 50;
  measured: the service's code defaults POSTS_PER_AGENT_PER_DAY to 3 and the 50 is a production setting the card
  reports; both comments now name the setting and say where the number comes from. NOTED for the card: if production
  is still at 3, a post over it is held for the next window while `kosmos community post` has already said "Posted";
  that predates this change. NITs taken: the quota guard also refuses "at least", "N a day", "should post", "post
  daily"; the test uses the file's cb; no trailing blank line; the plan says what else changed and that running agents
  keep the old line until they restart.
- Round 2 (sonnet): FIXED W: both comments still stated the production raise as fact; the block's comment now says the
  card says production allows more, and communitysend's says only what the service's code says (3 by default). NITs:
  the comment re-flowed; LEFT: the quota guard checks the wordings named in the test, not every possible one; "a few"
  is the card's decided soft ceiling (Splinter's call, overridable).
- Round 3 (opus; the reviewer says the diff printed this file whole, so not counted as blind): REPEAT W, settled by
  measurement: production's POSTS_PER_AGENT_PER_DAY is 50 (Mona Lisa read it from the running service, 21:32); and
  TAKEN, because any other deployment is at 3: a post past the cap was told plainly "Posted"; postLater, the route's
  later: true and both CLIs now say it goes once the cap lifts (tests on all four; each reddened alone). NITs taken: the
  comment says what the service's code says about both caps.
- Josh 21:33 (via Splinter on the card): the rule became "at least once a day, no more than 5", honesty intact; the
  bullet rewritten, with the honest post an agent with nothing finished has, and "never invent". An existing reply-rule
  guard read "at least once" across the whole block; it now reads the reply rule's own text, and still reds when the
  reply rule says it (mutation aimed mid-sentence, after two first tries that tripped other asserts first).
- Round 4 (sonnet): FIXED W: postLater promised "once the cap lifts" without asking whether the post would be sent at all
  (Community off, an address not allowed, a refused key, unreadable state); the route now asks postWaits, willSend's
  gate AND the wait, before the store write as willSend requires (unit test with seams: off, refused, control; route
  test: the answer follows postWaits and is asked before the store; each reddened alone). The route test drives
  postWaits, because a live sweep rewrites the keys file under a test that seeds it (found when a mutation passed in the
  whole file and failed alone). DOCUMENTED W: the post that crosses the cap is answered plainly (the cap is known only
  after the service's 429), in the code and the plan. NOTED W: outside production the cap is 3, so 5 a day can reach it;
  the capped line covers every post after the first. NITs taken: the posting bullet's numbers are pinned exactly to 5
  and 300; the communitysend comment re-flowed with both caps named as defaults.
- Round 5 (opus): FIXED W: asking willSend from the post route records the ON period's start before the store write, so a
  post made before the first sweep of an ON period is now inside the window and sent (as a comment already was); the
  module header and the route comment say so. NIT taken: the ceiling is a named constant (POSTS_PER_DAY_MAX, beside
  FOLLOW_EVERY_DAYS), pinned at 5. LEFT for its own card: a 429 from the service's per-minute request limiter is taken
  for the daily cap (sendPost treats every 429 so; it predates this); "for today" is approximate (the cap is a rolling 24
  hours).
- Round 6 (sonnet): FIXED W: a held post could carry later: true (the CLIs read held first, but the reply said it); later
  is now sent only with published (test: a held post under a waiting cap has no later; removing the gate reds it).
  DOCUMENTED W: the period-start effect of asking willSend is under Decided. DUPLICATE W: the post that crosses the cap
  is answered plainly (round 4). NITs taken: the reply-rule slice reads plainly; the cap comment keeps only what stays
  true (3 by default, production higher).

