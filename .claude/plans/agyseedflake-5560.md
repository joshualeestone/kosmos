# agyseedflake-5560: the #4417 launch-report test flakes on loaded CI runners (#5560)

`engine/agyseed-4417.test.js` 'the launch event reports idle from the new pane' failed on GitHub-hosted node runs
(main itself at 5cbb3f670, run 37719913706, and two other PRs), always as the only failure; it passes alone.

## What the failing run shows (measured, job 113127146383)
- `assert.equal(r.code, 0)` failed with `null !== 0` after 56 ms. Code null means the child never exited with a code:
  it was ended by a signal or could not start. It is NOT the bridge's 1.5 s request timeout (that path exits 0).
- The same run logged `EAGAIN` from another test (`Kosmos board restart could not start: EAGAIN`): the runner was at its
  process limit.
- The helper listened only to `close(code)`, so it could not tell "never ran" from "ran and failed", and it threw away
  stderr.

## Change (test only; the bridge is unchanged)
- `runOnce` records the exit code, the signal, a spawn error and stderr.
- `runBridge` tries again, up to three times with a short wait, ONLY when the child never ran (a spawn error or a null
  code); a child that ran and exited with a code is never retried, so a bridge that really fails still fails.
- The assertion message prints how each try ended.

## Decided
- Retry in the test rather than lengthen anything in the bridge: the bridge's timeout and behaviour are right; the
  runner killing or refusing a child is not the bridge's failure.
- Weakest premise: a child killed AFTER its request reached the stand-in board would, on retry, send a second report,
  and the test asserts exactly one. The failing run died at 56 ms, before a request could plausibly finish; if this
  shape ever shows, the message now says so.

## Tests
- Simulated a killed first try: with the retry the test passes; with the retry removed it fails and names the signal.
