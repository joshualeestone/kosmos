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
- Read it only once its own browser wait would certainly have fired (3 x 150ms past start), so
  staying in awaiting-code can only mean the device wait.
- The failure message carries the session's error, so a real timeout names itself.

## Evidence
- Slow stand-in (400ms): the fixed test passes.
- Control: engine giving win32 the browser wait (chatgptLoginTimeoutMs returns loginTimeoutMs):
  the fixed test reds, "timed out on the browser wait ("the OpenAI sign-in timed out")".
- 20 runs of the file, four in parallel, load average 9-12: 0 failures.

## Weakest premise
The first wait is bounded by waitFor's 8s default: a stand-in that cannot print in 8s still fails,
now with a "timeout; last {...}" message naming the state.
