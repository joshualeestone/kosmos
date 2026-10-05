# tmpleaks-5334: the test files on #5334 stop leaving temp folders (#5334)

Card: kosmos#5334 (night-shift shard). Owner: Angel.

## Finished looks like
Running any test file named on the card leaves no new folder in the real temp root.

## Changes
- The 15 test files on the card require test-support/tmpscope first (each run gets its own temp folder, removed at exit,
  on SIGINT/SIGTERM/SIGHUP, and in child processes through the inherited TMPDIR).
- engine/status.test.js is the exception: tmpscope lengthens TMPDIR and the test that points TMUX_TMPDIR at a temp folder
  then overflows the Unix socket path limit (measured: "we could not see what is running"). It removes its tsock folder
  in the test's own finally instead.

## Decided
- The browser checks need no change: docs/browser-checks/lib-sandbox-home.js already removes its homes through
  remove-at-end; its leftovers come from runs killed with SIGKILL (a queue cap), which nothing in-process can catch (the
  card says so). render-reload-toast.js makes no temp folder; the `whatsnew-` folders came from engine/whatsnew.test.js.
- tmpscope rather than per-file test.after: one line per file covers every mkdtemp in it, including future ones.

## Validation
The 16 files pass (591 tests; status 235/235 after its fix). Leftover count by prefix unchanged across a run of all 16.
Control: the origin/main filelock test left 10 new folders; the fixed file left none.
