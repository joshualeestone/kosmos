# bcfull-timeout-6312: the nightly full browser-check run was cut off, not red (kosmos#6312)

## Finding
Run 38912844654 (10-16) hit the checks step's 120-minute limit: 8192 PASS lines, 0 FAIL, no
`FAILED-LIST` line (the driver never reached its summary). The step's time on GitHub-hosted
`macos-latest`, from the jobs API: 97 (10-13), 101 (10-14), 110 (10-15), 121 (10-16, cut off).

Per-check times from the 10-13 and 10-16 logs (time between `=== label ===` headers): the 232 checks in
both runs moved by 1.1 minutes in total. Two NEW checks took 56 minutes: render-account-codex-6176
(42.7) and render-account-fivehour-6176 (13.2). Inside them, two arms took 19 and 22 minutes: each
called `clock.runFor` over seven fake hours, which fires every page timer in that span one by one.
113 checks never ran before the cut.

## Change
1. The two checks use `clock.fastForward` for the hour-scale jumps (codex p3 and p4, five-hour p10),
   each followed by a 5-second `runFor` so a timer armed at the end of the jump still fires.
   Locally: codex 72 s, five-hour 229 s, both green.
2. `browser-checks-runfor-6312.test.js`: no `clock.runFor` in docs/browser-checks over 30 fake minutes,
   and an argument it cannot evaluate fails rather than passing unread.
3. `.github/workflows/browser-checks-full.yml`: checks step 120 to 240 minutes, job 170 to 285, as a
   guard against a hung run; billing follows minutes used, not the limit.

## Rejected
- Sharding the nightly: each shard repeats checkout, provisioning and board boots, about a third more
  macOS minutes a night, and it would not have fixed two checks wasting 56 minutes.
- Only raising the limit: hides the cost and the next hour-scale runFor adds more.

## Proven
- Mutants on web/index.html, run against the edited codex check: the six-hourly bug (no six-hour filter
  plus a 6-hour cap) reds "a weekly window alone arms no six-hourly read"; no wake timer reds "a window
  more than six hours out still goes at its reset". So fastForward keeps both arms able to fail.
- The new guard flags exactly the two original codex lines (420 and 470 fake minutes) on a copy of the
  origin/main check, and passes on the edited tree.
- `tools/test-browser-checks-workflow.sh` passes and reds with the step equal to the job.

## Weakest premise
That 30 fake minutes is the right cap. On CI it is about 80 real seconds per call; the largest call
today is exactly 30.
