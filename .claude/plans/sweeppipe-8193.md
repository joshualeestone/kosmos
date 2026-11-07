# sweeppipe-8193: the iOS sweep check false-fails because it matched

Card: kosmos#8193.

## Problem
ios/LogicTests/run-sweep.sh (set -euo pipefail) checks two waits with `... | grep -qE`. grep -q exits on its first
match; a writer still writing takes SIGPIPE (141) and pipefail makes the check FAIL on a file that matches. Seen on
PR #8190 attempt 2 (0.375 s fail, attempt 1 passed on the same commit).

## Change
1. run-sweep.sh, the Agents and Projects wait checks: `grep -qE` to `grep -cE ... >/dev/null` (reads to the end, exits 1 on no match).
2. earlyReaders() moved from cli.agent-remove-7362.test.js to test-support/early-readers.js, shared. One change to
   it: a reader's words end at an unquoted ; && or ||, so `[ "$x" -eq 0 ]` after `| grep -v` is not read as -q.
3. New ios.logictests-pipefail-8193.test.js: every ios/LogicTests/*.sh with pipefail has no early reader; controls
   for the pre-fix line, the PIPESTATUS line, and ; / && cuts; a macOS-only behaviour arm (sed -l writer over a made-up input) where
   grep -q fails on a match and grep -c does not.

## Measured
- 41/50 false fails with pipefail + grep -q and a line-buffered sed; 0/50 without pipefail.
- New file + cli.agent-remove-7362: 29 pass, 0 fail.
- Perturbation 1 (put grep -q back): guard red. Perturbation 2 (no ; cut): guard and control red.
- ios.board-parity-7084 sweep suite on the fixed script: pass.
