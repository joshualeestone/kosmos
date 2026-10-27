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
- New arm `#7258`: `KOSMOS_TEST_CURL_SLOW_FIRST=1.5` makes the counting curl sleep 1.5 s before the first try,
  standing in for a loaded machine (0.8 s in the first version; see round 1).

## Measured (this Mac, light lane, 18:1x CDT, load 2 to 4)
- Old file and new file run alternately, 6 runs each: old 11/11 green every time, new 12/12 every time. The idle
  machine does not reproduce the red, as the card expected.
- The #7258 arm put back on the 600 ms clock: RED (1 of 1). On the refusal trigger: green.
  So the arm reproduces the mechanism on demand, and it guards against a return to a clock.

## Weakest premise
That the 600 ms clock is the cause on Mortals. The arm reproduces that mechanism; it does not prove Mortals hit
this and nothing else. A second slow point remains by design: refusal -> retry is the CLI's one-second pause, so a
board that cannot relisten within ~1 s of the refusal (an event loop stalled for over a second) could still go red.
The board's port is free from the stop until the first refusal, however long that takes, so another process could take
it on this shared machine; that shows as relistenError, a clear red, never a false green.

## Rejected
- Raising 600 to a bigger number: just moves the race, and past 1000 ms the board would miss the retry instead.
- Lengthening the CLI pause with KOSMOS_REFUSED_RETRY_MS in these arms: costs seconds per arm and still races.

## Review rounds
- Round 1 (blind, default model, 18:2x CDT): no BLOCKER. Applied:
  (1) WARNING, the slow arm at 0.8 s guarded only against the 600 ms clock: a 1000 ms clock passed every arm idle. Now
  1.5 s. The fast arms need a clock under about 1.1 s and the slow arm one above about 1.6 s, so no fixed clock passes
  both.
  (2) WARNING, the cutFirstPost arm was still on a 2500 ms clock, exposed to the same load: it now uses the refusal
  trigger too. A regressed third try still lands on a listening board, so it shows in both the try count and the POSTs.
  (3) NIT, the port-loss window is open-ended: noted under the weakest premise.
  (4) NIT, an unwrapped doc comment: rewrapped.
  (5) NIT, a refuse-once board with no baseEnv log polled `undefined.rc` forever: it now throws with the setup mistake.
  Measured after round 1 (light lane, 19:3x CDT): the whole file 12 of 12, three times. The slow arm back on a 600 ms
  clock: red. On a 1000 ms clock: red. The fast task-list arm on a 1000 ms clock: green, so the slow arm is what
  catches a clock in that range.
- Round 2 (blind, sonnet, 19:4x CDT): no BLOCKER and no WARNING. It confirmed that the cut-reply arm still goes red on a
  regression (msg's second ask losing _KOSMOS_CURL_ONCE gives 3 tries and 2 POSTs), and that no fixed clock passes both
  the fast arms and the slow one. Nits applied:
  (1) the port-to-log map is cleared when an arm ends, so a reused port cannot hand a later arm an old 7;
  (2) a missing log is reported through the arm's relistenError instead of thrown inside the request handler;
  (3) the slow-first comment says "first" means the counting curl's first call.
  Nit (4) needed nothing (the stall bound is the weakest premise above). File 12 of 12, three runs.
