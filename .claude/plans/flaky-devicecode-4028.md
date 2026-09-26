# flaky-devicecode-4028: the win32 device-wait test waits for the code before reading it

Card: kosmos#4028.

## What was wrong (measured)
The card's likely cause (the Windows sign-in timed out on the 150ms browser wait) is not what
happens: on win32 chatgptLoginMode forces 'device' at start (engine/openaiaccounts.js:898), so its
watchdog is armed with the device wait from the beginning. The test read the Windows session ONCE,
the moment the Mac one errored (~150ms). The Windows stand-in is a whole node process (execPath +
a preload); under load it can take longer than that just to print, and until it prints the state
is 'starting'. The assertion then failed with a message blaming the browser wait.

Reproduced: a stand-in that prints 400ms late fails the old test with actual 'starting', expected
'awaiting-code', and the card's exact message.

## Change (test only)
- Wait for the Windows session to reach awaiting-code (or error) before anything else.
- Then read it as soon as the Mac one has errored: both watchdogs are armed within a millisecond
  (two synchronous starts) and the Mac error is observed through a 25ms poll, so a browser-wait
  Windows would already be in error, in either start order (the reviewer measured both).
- The device wait in this test is 60s (was 5s), so a slow stand-in fails on the wait for its code,
  naming 'starting', never on a watchdog whose error text matches the browser one.
- The failure message carries the session's error, so a real timeout names itself.

## Evidence
- Slow stand-in (400ms): the fixed test passes.
- Control: engine giving win32 the browser wait (chatgptLoginTimeoutMs returns loginTimeoutMs):
  the fixed test reds, "timed out on the browser wait ("the OpenAI sign-in timed out")".
- 20 runs of the file, four in parallel, load average 9-12: 0 failures.

## Weakest premise
The first wait is bounded by waitFor's 8s default: a stand-in that cannot print in 8s still fails,
with a "timeout; last {...}" message naming the state. (Before iteration 1 the real bound was the
test's 5s device wait, which failed with a message blaming the browser wait; now 60s.)

## Iteration 1 (opus)
- Confirmed independently: old test 13/16 failures at load ~15, new 0/16; the engine perturbation
  (win32 on the browser wait) still reds.
- WARNING: the real bound was the 5s device wait, whose error text is the browser one --> 60s, the
  message carries elapsed time, the premise corrected.
- NIT: the 3 x 150ms settle's comment gave the wrong reason for certainty --> removed; the reason
  (timer order) is stated. NIT: the test bounds the device wait below by ~150ms, not at its value;
  the value is pinned by the chatgptLoginTimeoutMs test. Kept.

## Iteration 2 (sonnet)
- Confirmed: old test 16/16 failures at 4x parallel load, new 20/20 passes; the engine
  perturbation reds 28/28, including with the two starts swapped.
- WARNING: the comment credited timer ARM ORDER; the margin is the 25ms poll against a sub-ms gap
  between the starts, and order does not matter --> comment and plan corrected.
- NIT: DEVICE_WAIT_MS named. NIT: plan-name timestamp, the repo's prevailing form; kept.
