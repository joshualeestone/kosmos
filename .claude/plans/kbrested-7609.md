# kbrested-7609: check 3 waits on the sample scroll-up, not on a clock

Card: kosmos#7609 (follow-up to #7344). Angel measured `testReadHigherUpStaysWhereItWas` failing 1 run in 8 under
heavy load ("'Message 213 of 260.', read higher up, left the screen when the keyboard came up"), and 6 of 6 passing
alone (3 on main, 3 on her branch).

## Finished looks like

Check 3 taps the message box only after the DEBUG sample scroll-up hook has told the chat the reader moved up, whatever
the machine's load, and it still fails when the chat pulls the reader down.

## The change

- `ios/Kosmos/ChatView.swift`: a `sampleScrollRested` flag, set only by the DEBUG `KOSMOS_SAMPLE_SCROLLUP` hook in the
  same block that sets `atBottom`; while it is set, a 1x1 clear overlay carries the accessibility id
  `sample-scroll-rested`. Nothing else sets it, so a release build never shows it.
- `ios/KosmosUITests/KeyboardSlideUITests.swift`: check 3 waits for that id (30 s) instead of sleeping until 4.2 s after
  the rows appear.

## Rejected

- A longer fixed wait: still a guess about time, on CI runners slower than this Mac.
- Reading the app's trace from the test: the UI test cannot see the app's trace.

## The cause of Angel's failure: NOT known

The first guess was that the hook's 3.6 s step ran late under load, so a tap at 4.2 s still read the reader as at the
newest. **Arm C refuted it as the cause:** with that step delayed to 8 s, the old check still passed, because the
check's own row sweep after the scroll-up takes several seconds (about 6 s in arm F's trace), so the tap lands after
the step anyway. The marker wait is kept because it removes a timing guess, not because it fixes the flake.

A second guess, unmeasured: a read of the conversation landing between the scroll-up (3.0 s) and the step (3.6 s)
re-pins the chat to the end while `atBottom` is still true. Nothing here shows it happens.

So this branch also makes the next failure explain itself: check 3 runs with `KOSMOS_SAMPLE_TRACE=1`, and on a failure
`ui-keyboard.sh` prints the last 30 scroll events from the app's `Documents/trace.txt` before deleting the simulator.

## Arms

Fresh iPhone 17e simulator (iOS 27.0), `ios/tools/ui-keyboard.sh`, 10-30 06:3x to 07:0x CDT, one run each:

| arm | change | result |
|---|---|---|
| A | this branch | 3 of 3 pass |
| B | hook step delayed to 8 s, new check | 3 of 3 pass (the wait follows the hook) |
| C | hook step delayed to 8 s, OLD check (4.2 s) | 3 of 3 pass (the first guess is not the cause) |
| D | `keepNewestInView` forced true, new check | check 3 fails ("Message 213 of 260") |
| E | this branch with the trace on | 3 of 3 pass |
| F | forced true, trace on | check 3 fails and prints the trace: `debug scroll-up rested, atBottom false`, then `keyboard up 328 (atBottom false)`, `keyboard shown, to the newest`, `end appear` |

Weakest premise: Angel's flake has not been reproduced here, so whether it recurs under load is still open; the trace
is what will say.

## After review round 1

- The flag and its overlay are inside `#if DEBUG`, like the hook, so a release build carries neither; the hook resets
  the flag when it schedules a scroll-up, so the marker means "this scroll-up has rested".
- The trace prints only when the log shows check 3 itself failed (a failure of check 1 or 2 no longer prints a passing
  run's events under another check's failure). The pattern was checked against a failed check 3, a failed check 1 and a
  passed check 3: it matched only the first.
- `--help` and the header say a failure prints the scroll events, which live in the simulator (not in `--keep`).
- **Deferred:** that writing the trace changes the check's timing. Arm F's trace held about 12 events over ten seconds
  and no per-row lines, so the extra writes are small; if a flake still reproduces only with the trace off, that is the
  thing to look at next.

Arms after round 1 (10-30 07:0x to 07:2x CDT, one run each):

| arm | change | result |
|---|---|---|
| G | this branch | 3 of 3 pass |
| H | `keepNewestInView` forced true | check 3 fails and prints its scroll events |
| I | the marker never set | check 3 fails: "the sample scroll-up never came to rest" (the wait can fail) |

**Observed in arm H, not fixed here:** `xcodebuild` sat for about ten minutes after the tests had finished (its log
said "Executed 3 tests, with 1 failure" at 07:13); stopping the inner `xcodebuild` let the runner finish and print the
trace. The runner has no timeout of its own, so a CI job that wraps it should set one.
