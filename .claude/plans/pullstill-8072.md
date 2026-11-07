# pullstill-8072: the end-pull tests wait for a long chat, and say what they saw (kosmos#8072)

## Problem
PR #8148's UI job went red on two EndPullUITests, on a PR that touches no chat: `testALongChatPullBouncesBackUnderTheDots`
(landed at 624.67, started at 727, limit 20 pt) and `testASecondPullCountsToo` at "no dots after the first pull". Main's
one run since they landed passed. In the same red run another test skipped itself as too slow to measure.

## What it could be: two explanations, not settled
1. **Timing.** The chat was still finishing its open when the test pulled, on a slower runner. A fixed 3 s sleep, or none, lost.
2. **The chat really sat 103 pt short of its end, and a touch settled it.** Then no wait helps, and the first pull finding no
   end marker fits this too (`allowed` needs `endVisible`). If so, a person could see it, and this is an app defect, not a test
   one. `ChatOpensAtNewestUITests`, the strict check, is not in CI (ui-sample.sh), so nothing else here would catch it.

The matching 103 pt, also recorded by this test's old comment, shows one discrete layout difference. It does not choose between them.

## Finished means
The two tests pull after the row has stopped moving, and a red says how long they waited and how far the row moved, so the next
red separates the two explanations. It does NOT mean the flake is cured. That needs repeated green on the slow runner, or a red that names the cause.

## Change
Test only: `openFinished`, polling each 1 s until the row has not moved for 6 s, up to 45 s, and returning what it saw for the
assertion messages. A row that is gone or has no position counts as not still. No app code.

## Decided
- Rejected: a longer fixed sleep (a guess); widening the 20 pt limit (would hide a real failure).
- Rejected for now: an app-side marker from the open's real state, as `sample-scroll-rested` replaced a clock wait. It is the better
  fix under explanation 1, but it changes app code on a guess. Measure first.
- It carries on at the limit and says so, rather than failing there: the assertions after it decide.
- `testAMessageLandingAroundAPullShowsAndNothingBlanks` is unchanged: its sample keeps moving the list, so a quiet wait cannot end. It stays exposed.

## Weakest premise
That waiting helps at all. Under explanation 2 these tests go red again, this time with numbers saying "still, moved 0 pt": then
this is an app card, opened on the evidence, and I read the app's opening path.
