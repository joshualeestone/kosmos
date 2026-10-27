# wnprod-0771: What's New for 0.7.71 after 0.7.70 reached prod (kosmos#7281)

## Why
The 0.7.71 re-cut (pinned 53091c2392) stopped at release.sh step 1b-ii: prod now serves 0.7.70 (promoted 08:3x 10-27,
Josh's GO) but release/whats-new-pool.json recorded 0.7.69, so 0.7.70's five highlights were not marked shown and the
0.7.71 window would repeat two of them. The cut's own check, working as designed.

## Change
`node tools/whats-new-pool.js build 0.7.71` (it reads what Mac prod serves and records it): 0.7.70's five highlights are
marked shown (shownIn 0.7.70), lastProd 0.7.70, and the window is rebuilt. That brings "Community activity in Settings,
at a glance" (rank 12.6) into the window, so its line is tightened first, as the whatsnew-0771 reviews required before it
could be chosen: one sentence, no every-agent link claim (#7254 gives an unregistered agent none):
"Settings now shows how many posts and comments your agents have in the community, with the full list folded away."
The window: the damaged-file, links, tables and community items, plus "Moved agents keep your imports answer" (0.7.47).

## Proof
whats-new-check 0.7.71: 5 highlights (mac 5, windows 5). `whats-new-pool.js prod-check`: the pool records prod 0.7.70.

## Review 1 (09:0x, opus): 0 blockers, 1 warning, 2 nits
- W1 FIXED: "Moved agents keep your imports answer" (0.7.47, rank 14.5, joins the window now) read as developer jargon.
  Reworded from #6085's own "what changes for the person": title "A moved agent is not asked again", line "A Claude
  agent moved to another account is no longer stuck on a question you already answered, unless its folder is in a git
  repository." (the exception #6085 keeps). It was never shown, so the title change cannot break a `shown` match.
- NITs RECORDED: the community line does not name where in Settings it is; it counts moderator-removed comments too.

## Added: engine/tasks.repeat-4787.test.js steps days with nextAfter (DST)
Found by this branch's validation (1 red, red alone twice, red on main too): the #4787 slice 2 test added days as
86400000 ms. From 09:00 CDT on 2026-10-27 its later steps cross the Nov 1 daylight-saving change, so in America/Chicago
(Mortals' zone, and the Agent1s CI runners') a run lands an hour off its 09:00 slot. Red in Chicago and New York, green
in UTC, Tokyo and London; it passed at 07:17 because before 09:00 its slots stopped short of Nov 1. It would have
aborted the 0.7.71 re-cut at step 3. The product already follows the clock (taskrepeat.nextAfter); only the test
assumed a 24-hour day. Fix: day2 and day3 are taken with nextAfter. 25/25 in all five zones. Carried in this PR so the
re-cut needs one CI cycle, not two.

## Review 3 (09:2x, opus, the combined diff): 0 blockers, 1 warning, 3 nits
- W1 FIXED: the missed-day assertion could pass vacuously (lastRunLate was already undefined from the run before);
  it now first asserts the run was recorded (lastRunBy bob).
- NIT FIXED: day2 and day3 are asserted to be 09:00 local, so the test no longer only trusts nextAfter.
- The reviewer simulated the slot sequence for two years in nine zones (both hemispheres, a half-hour DST zone):
  0 failures with nextAfter; the old ms sums failed about 310 times per DST zone and never in UTC, so it can see the bug.
- NITs RECORDED: the moved-agent exception rests on #6085's reading of the binary; the community count includes
  moderator-removed comments.
