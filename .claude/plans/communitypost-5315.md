# communitypost-5315: the first community post of the day cannot be skipped by an agent that has done work (kosmos#5315)

## Why
The daily community-post reminder (`engine/communityturn.js` TURN_TEXT) ends "Otherwise, if there is nothing real to
share, do nothing." An agent in the middle of work reads that as permission to skip, so the daily floor post rarely
happens. Splinter (PM) 10-05 and Josh ("one a day is fine if they do it") decided to build this. The quota is unchanged
(Splinter's call on #5297): the opt-out is only removed for the first post of the day, and kept for posts beyond it.

## Change
`engine/communityturn.js`:
- Extract the shared lead of the turn prompt into `TURN_LEAD` (the numbers still come once from communityblock.FLOORS
  and MIN_WORDS, per #5297 item 3). `TURN_TEXT` is now `TURN_LEAD + <its old tail>`, byte-for-byte what it was.
- Add `FLOOR_TEXT = TURN_LEAD + <no-opt-out tail>`: it drops "if there is nothing real to share, do nothing" and keeps
  "Never invent work or results to have something to post."
- `due()` pushes a `postedToday` flag on each due agent: `at.length > 0 && now - last < DAY_MS`. This is the same
  condition that already gates the #5296 worked-since path, so it reuses the existing notion of "the daily floor is met".
- The turn's text selection becomes: never-posted -> INTRO_TEXT (unchanged); posted in the last day -> TURN_TEXT
  (opt-out kept); below the floor -> FLOOR_TEXT (no opt-out). The #5212 `lineFor` override still wins over either
  generic line when there is a waiting-activity line.

## Finished looks like
The prompt for a no-post-today agent has no skip line (FLOOR_TEXT), the prompt for an agent that already posted today
keeps it (TURN_TEXT), and a test pins both (the constants' wording and the actual tickOnce selection for each case).

## Tests
`engine/communityturn.test.js`:
- New `#5315` test: FLOOR_TEXT has no "do nothing", keeps "Never invent" and the honest-post line, names kosmos community
  post, and has no em/en dash; TURN_TEXT still has "do nothing" (CONTROL). Then tickOnce actually delivers FLOOR_TEXT to a
  below-floor agent (last post 30 h ago) and TURN_TEXT to a posted-today agent (6 h ago) (CONTROL). These exercise the
  selection, so they fail on a build that adds the constant but does not wire the branch.
- Extend the #5297 single-source test to assert FLOOR_TEXT carries the same numbers and honest-post wording as TURN_TEXT
  and the block body.
- The existing text assertions (176, 284, 321, 328) all use posted-within-24h fixtures, so they stay on TURN_TEXT; no
  existing test changed its expectation.

## Rejected
- Changing INTRO_TEXT (never-posted agents): out of scope. INTRO already offers an introduction in place of a work post,
  so its opt-out is a different case than the daily floor. See weakest premise.
- Gating the floor prompt itself on "worked since": the below-floor path already prompts once a day regardless of work
  (#5636); #5296's worked-since gate is only on the beyond-floor path. The card's "has done work" is about not skipping
  the first post, not about adding a new due condition. Who is due is unchanged; only the TEXT changes.

## Weakest premise
That the never-posted (INTRO) case should keep its opt-out while the floor case loses it. A never-posted agent that has
done work is arguably the same "first post of the day" the card is about. I left INTRO unchanged because the card's
"Finished looks like" enumerates the two TURN cases only, and INTRO's opt-out is paired with an introduction alternative
that the floor prompt has no equivalent of. If review wants INTRO's opt-out dropped too when the agent has worked, that
is a one-line follow for the INTRO branch; it would also need the worked-since signal, which INTRO does not read today.
