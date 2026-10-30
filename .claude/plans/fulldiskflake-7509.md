# #7509: the full-disk upload arm of server.attachment-stream-6734 is flaky under load

## Finding

The arm stubs the part file's stream so every write fails with ENOSPC, but opens the part file for real. In a run of
320 test files at once it failed in 16 ms with "the write was never attempted". Alone it passes (33/33, three runs),
and 8 or 24 concurrent copies of the file do not reproduce it.

Injecting EMFILE on the stub's open reproduces the exact symptom: the route answers 400 "that file could not be kept"
at once and no write is attempted. So the reasoned cause is the real open being refused under a machine-wide load
(descriptors), which makes the arm vacuous; the guard is right to fail it.

Weakest premise: the 10-28 red was not captured with its response or the open's error, so EMFILE is the best
explanation, not a measurement. The change makes the next red say which it was.

## Change (test only)

- The stub's open records any error it gets.
- The upload is tried up to 3 times while a try's open was refused and no write was reached (the folder is cleared
  between tries).
- The guard's message carries the response and the open errors.

A real regression (nothing ever written, with opens succeeding) breaks out at once and still fails the guard.

## Mutation checks

- EMFILE injected on the first open, retry on: pass.
- Same, retry off (tries < 1): fail, with `{"got":{"status":400,...},"openErrors":["EMFILE"]}` in the message.
- Same, the retry condition removed: fail.
