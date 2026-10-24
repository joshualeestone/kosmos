# fwfix-6668: the stopped-runner arms of the #6668 test, red inside Mortals' full suite

## The defect

Two arms of `tools.run-tests-file-timeout-6668.test.js` ("a runner sent TERM leaves no watchdog" and "a runner
stopped by Ctrl-C (INT to its group) leaves no watchdog") failed inside Mortals' full suite after 31.5 s with "no
single persistent watchdog under the runner (node --test not started, or candidates: )". Alone they passed 16/16.

## Cause (measured)

Mortals validates with `yarn test`. yarn 1.22.22 puts its own `node` first on PATH, a script that runs
`exec "/opt/homebrew/Cellar/node/26.8.1/bin/node" "$@"`. So the runner's `node --test` child reads in `ps` as
`/opt/homebrew/Cellar/node/26.8.1/bin/node --test ...`. The arms' helper matched node --test by bare name only
(`startsWith('node --test ')`), never saw node, and never looked for the watchdog. The runner's own watchdog
matches by name or by full path (`tools/run-tests.sh`, `"node --test "*|*"/node --test "*`), so the watchdog
worked and every other arm passed in the same run.

Ruled out: a refusal before node (the other arms, same env, passed in the same run); the outer runner's env (green
inside an outer `run-tests.sh --only`, here and on Mortals); bash 5.3 or load on Mortals (green alone at load 33).

## Fix (test only)

- `isNodeTest()` mirrors the runner's rule: by name or by full path.
- The helper writes the runner's output to a per-arm file; both of its reds print the runner's process tree and the
  tail of that output, so a refusal or a missed match is never silent.
- New arm: the TERM stop behind a yarn-shaped exec wrapper first on PATH, asserting node --test ran by
  `process.execPath`, so it cannot pass with no wrapper.
- An `after()` removes the fixture directory.

## Before and after (this Mac, through real yarn via a package script)

- HEAD under yarn: both arms red, 30048 ms and 30014 ms, the Mortals message.
- Fixed, under yarn: 17/17. Fixed, alone: 17/17.
- Mutation: the bare-name match restored, the new arm is red (30086 ms); restored and compared with cmp.
- Every test file naming run-tests.sh (33), from the repo root: 1010 tests, 1009 pass, 0 fail, 1 skipped.
