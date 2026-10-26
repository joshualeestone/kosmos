# #7258: cli.refused-retry-6968.test.js red under load

## Cause (read from the test, then reproduced on demand)
The refuse-once fake board listened again on a clock, 600 ms after it answered the health check. The CLI's first
kosmos_curl try had to land inside those 600 ms to be refused. On a loaded machine (Mortals, load 13 to 33) the shell
work between the health check and the request ran longer, the try found the board back, and the four
`withRefusingBoard(600, ...)` arms counted 1 try where they assert 2. That matches every failure on the card.

## Fix (test only; install/kosmos unchanged)
- The counting curl on PATH no longer execs the real curl. It runs it, appends the exit code to `<log>.rc`, and
  exits with that code.
- `withRefusingBoard('refused', ...)` polls `<log>.rc` every 10 ms after it stops listening, and listens again once a
  try has ended in curl's 7. The first try is refused however late it comes. The one remaining bound is the CLI's
  one-second pause between the refusal and the retry.
- The board finds the arm's log through `CURL_LOG_BY_PORT`, which `baseEnv` fills (port -> log path).
- New arm `#7258`: `KOSMOS_TEST_CURL_SLOW_FIRST=0.8` makes the counting curl sleep 800 ms before the first try,
  standing in for a loaded machine.

## Measured (this Mac, light lane, 18:1x CDT, load 2 to 4)
- Old file and new file run alternately, 6 runs each: old 11/11 green every time, new 12/12 every time. The idle
  machine does not reproduce the red, as the card expected.
- The #7258 arm put back on the 600 ms clock: RED (1 of 1). On the refusal trigger: green.
  So the arm reproduces the mechanism on demand, and it guards against a return to a clock.

## Weakest premise
That the 600 ms clock is the cause on Mortals. The arm reproduces that mechanism; it does not prove Mortals hit
this and nothing else. A second slow point remains by design: refusal -> retry is the CLI's one-second pause, so a
board that cannot relisten within ~1 s of the refusal (an event loop stalled for over a second) could still go red.
Untouched on purpose: the cutFirstPost arm (`withRefusingBoard(2500, ...)`) is also clock-based, but it did not fail
on the card and its clock is 1.5 s wider than the pause it races.

## Rejected
- Raising 600 to a bigger number: just moves the race, and past 1000 ms the board would miss the retry instead.
- Lengthening the CLI pause with KOSMOS_REFUSED_RETRY_MS in these arms: costs seconds per arm and still races.

## Review rounds
