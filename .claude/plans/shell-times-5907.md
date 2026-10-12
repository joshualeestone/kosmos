# shell-times-5907: time every test:shell command (kosmos#5907)

## Problem
Full local suites run 75 to 110 minutes against the 14 to 26 documented in `tools/lib/cut-guard.sh` (#4574), and the
validation queue backs up for over an hour. No local log can say which shell files the time goes to: the local path
ran `yarn -s test:shell`, one `&&` chain with no timing.

## Measured before building
- CI main run 38209904744 (afa22b680): node 8m14s, shell 1/2 27m01s, shell 2/2 24m18s; serial ~60 min uncontended.
  The shell part was 1,021 s when shell-shard.js was sized (probe 36412608975); it is 2,947 s now.
- CI's slowest file, test-update-putback-4818.sh (913 s), takes 72 s locally on origin/main. CI cannot rank local files.
- One local full validation (#5900, 2026-10-12): 36 min, node 486 s.

## Change
1. `tools/shell-shard.js` `runShard`: after each command print `shell-shard i/n [k/N] <s> s: <command>`; end the shard,
   green or red, on its total and its `SLOWEST` (10) slowest commands. `write` and `clock` are seams.
2. `tools/run-tests.sh`: an unsharded shell part runs `node tools/shell-shard.js run 1 1` instead of `yarn -s test:shell`
   (same commands, same order, stop at the first red). Prose naming yarn as something run-tests.sh runs is corrected.
3. `CLAUDE.md`: the Test section says run-tests.sh runs test:shell through shell-shard.js.
4. `tools.shell-shard-4317.test.js`: the yarn pin becomes a shard-1-of-1 pin plus "no line runs yarn"; new arms for the
   per-command lines, summary order and cap, a red shard's summary, and the real clock.

## Not done here (recorded on the card)
- Fixing slow files: needs the local ranking the new lines produce.
- The 14-26 figure and the queue bound in cut-guard.sh.
- cut-rerun-guard.sh's "~2-min yarn test" budget for up to 3 whole-suite reruns during a cut.
- CI's ~36 s per fake-board start in test-update-putback-4818.sh (cause not localized).

## Weakest premise
Dropping yarn from the local path changes nothing else. Evidence: CI shards run every command without yarn and pass; no
shell test reads `npm_*` or `node_modules/.bin` (a control on the same search hits provision-pw.sh).

## Status
- [x] Built, committed e2b59e1e8, pushed.
- [x] runShard probed with a stub clock (both arms); the run-tests.sh pins proven to match the new line and refuse the old.
- [ ] Focused test file through the queue.
- [ ] Challenge loop, final validation, PR.
