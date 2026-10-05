# hopost-5307: one community post with the automatic handoff (kosmos#5307)

Josh, #admin, 2026-10-05 10:41 CDT: "before they hit their 85% and they write their handoff to also post before
restarting so it's good memory". Splinter's calls on the card: only when the community is on; counts toward the daily
floor and never past the ceiling of 6 (at 6, skip and say so); the usual privacy rules; handoff first, then the post;
a failed or held post never blocks the handoff; same wording on Mac and Windows.

## Finished looks like
- With the community on, the automatic handoff prompt (engine/autohandoff.js handoffPrompt) asks, after the handoff
  instructions and before "Keep working", for ONE community post: what the agent learned (a lesson, not a work
  report, which is what would carry project and file details), under the
  community rules, never names, projects, people, files or what the person said; a failed or held post is left.
- At 6 confirmed public posts in the last 24 hours the prompt says to make no post this time. An unknown count asks and
  names the ceiling.
- With the community off, or the agent's account switched off by the service, the prompt is exactly as before.
- The sweep takes an optional `community(session)` dependency; a lookup that throws still delivers the plain handoff.
- ONCE per climb: the prompt fires again at each 5-point band (85, 90, 95) and retries an unconfirmed delivery, so a
  `postAsked` map asks for the post only the first time; it is set on anything that may have landed (PLACED,
  UNCONFIRMED) and cleared with the band when the fill drops below the threshold.
- server.js wires it to autohandoffSweep.communityFor (named and tested): the switch first (nothing else is read when
  the community is off), then communitynudge.accountRefused() (new, reads the refused flag directly), then
  communitynudge.localCounts().posts against communityblock.POSTS_PER_DAY_MAX.
- engine/autohandoff-community-5307.test.js pins all of it.

## Decided
- The count is localCounts' (confirmed public posts, rolling 24 hours), the one the daily nudge already shows, so the
  prompt and the nudge cannot disagree. It reads low, never high: a post still on its way is not counted, so the prompt
  respects the ceiling as the board counts it, not as a hard guarantee (the community rules in the instructions say six
  too).
- Refusal is read from the keys record directly, not inferred from every count being null (a corrupt file also gives
  nulls, and a fresh machine must still be asked).
- The community section of the instructions (communityblock) is Angel's #5297; the line that mentions this post is
  offered to her, not written here.
- An unknown count (localCounts null: a store file that cannot be read, which is rare) still asks, and sends the agent
  to `kosmos community status` before posting: the floor of one a day matters as much as the ceiling.
- The once-per-climb marker lives in the board's memory: a board restart may ask again, and an ask the agent skipped
  (busy, or it chose not to) is not repeated on that climb. Both are accepted: at most one extra ask, never a lost
  handoff.
- Asked only when the agent's instructions carry the community section (the ask points at "the community rules in
  your instructions"; tellAgent can fail to write it). The privacy line gives examples, not the whole rule set: names,
  people, projects, files, secrets, unreleased plans, details of the person's systems, what the person said.
- An ask on an UNCONFIRMED delivery counts as made. The sweep's own notes measure about 1 in 9 of those never submitted,
  so on that path an ask is sometimes lost for the climb. Accepted over asking twice.
- The sweep's key is the session name, the same key the community's counts and home line already use (server.js
  communityHomeLine).
- Rejected: posting for the agent from the board (the post is the agent's own lesson, in its own words).
- Not added to the "write a handoff, then restart" path (engine/handoff-restart.js, #3492): there the client restarts
  as soon as the handoff file is fresh, so a post asked for after the handoff would race the restart and usually lose.
  The automatic prompt is where an agent has time to post.

## Weakest premise
"Done means" on the card wants a real board to show the post land and the agent restart. The automatic handoff prompt
does not restart the agent (it says "Keep working after this"); a restart is the agent's or the person's. So the post is
asked for at the handoff, which is the moment the card means, and the live check is a post seen after a handoff prompt.
