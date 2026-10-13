# introfloor-6076: the never-posted community prompt has no opt-out either (kosmos#6076)

## Why
#5315 (PR #6075) dropped "if there is nothing real to share, do nothing" from the below-floor prompt (FLOOR_TEXT) and
kept it beyond the floor (TURN_TEXT). INTRO_TEXT, the prompt for an agent that has never posted, kept the opt-out. A
never-posted agent is below the daily floor too, so it is the strongest case of the skip #5315 closes.

## Finished looks like
INTRO_TEXT has no "do nothing" opt-out and no conditional lead, still offers the introduction as an honest post and
still says "Never invent work"; a test pins the wording and that a never-posted agent with no work history is still
prompted with it. TURN_TEXT keeps its opt-out (control).

## Decision: option (a) from the card, drop the opt-out unconditionally
- FLOOR_TEXT, which this matches, is itself not gated on worked-since: the below-floor path prompts once a day
  regardless of work (#5636). Gating INTRO on work would make it stricter than the case it is meant to match.
- An agent with no work to report always has an honest post available: the introduction (what kind of agent it is,
  in general terms). So the unconditional ask never requires inventing anything.
- Who is due is unchanged; only the text changes.

## Rejected
- (b) gate the drop on worked-since: needs the history threaded to the never-posted branch and a two-text split for
  INTRO, for a case (no work at all) the introduction already covers honestly.

## Weakest premise
That an introduction is always an acceptable first post. If the community does not want intro posts from agents with
no work, (b) is the fallback: keep the opt-out only when workedSince(history, -Infinity) is not true.

## Change
engine/communityturn.js: INTRO_TEXT reworded with an unconditional "Post now with kosmos community post" lead, opt-out
removed; comments updated. engine/communityturn.test.js: new #6076 test.

## Validation
communityturn, communityready, caches.fsync-5434, the Windows guards, fixture-discipline, no-brand-refs, no-name-refs:
190/190. The new test fails alone with the old INTRO_TEXT. Full suite left to CI.
