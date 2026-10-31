# win-npmtest-7257

**Posture:** production

Addresses #7257: `npm test` (tools/run-tests.sh) could not run on a Windows computer. Follows the design Angel left on
the card (night shift, 10-27), measured on the Windows box.

## Done when (from the card)
1. `npm test` on a Windows computer starts its tests.
2. The suite and install-harness probes give an answer on Windows, or skip there with a stated reason.

## Measured first (main 168f425f1e, this box)
- main's run-tests.sh with no overrides: "could not tell whether a test suite is running (the probe exited 2)", then
  waits in the queue (stopped after 10 minutes; its leftover waiter processes were ended by hand).
- With KOSMOS_TESTS_IGNORE_SUITE/HARNESS=1: `line 852: node: Argument list too long`, exit 126, no test runs.
- Git Bash's ps rejects -A and there is no pgrep: the probes and the #6668 per-file watchdog read the process table that
  way, so neither has ever worked here.

## Changes (tools/run-tests.sh; macOS/Linux untouched)
- `_RT_WIN=1` inside the existing MINGW/MSYS/CYGWIN case.
- On that flag the live-suite and install-harness checks are not run, with one line saying why (#7257).
- On that flag `node` is a shell function: for the one `node --test` call over KOSMOS_TEST_FILES (found by the file list
  in its arguments) it runs the same options and trailing arguments over the files in chunks of under 24,000
  characters, in order, returns the worst exit status, and prints `node --test ran in N chunk(s) over M file(s)`. Any
  other node call goes to node itself. The flush-left `node --test` line is unchanged, so #1934, #3605, #4273 and #4317's
  guards still find it (their pin tests pass).
- tools/windows-tests.js: the new test in ALSO_ROOT; the #7262 entry's comment updated (its tool-guard arms run on
  Windows since #7318).

## Verification
- Stand-in node on PATH (records each --test call), no overrides: the probes line, then 3 chunks of 663, 682 and 498
  files (argument lengths 22,642, 22,592, 15,747) = all 1,843 files; exit 0.
- Real node, 120 s, no overrides: tests run (4,205 passing results seen, 396 failing: many suite files are POSIX-only,
  out of scope); no "Argument list too long"; no node process left after the stop.
- tools.run-tests-chunks-7257.test.js (cuts the node() block out of run-tests.sh, runs it in bash with a logging
  stand-in): 3/3. Every file once, in order; each chunk under the cap with the same options and trailing arguments; the
  worst status wins; one small run is one chunk; a plain node call passes through; the line and flag are pinned.
- The pin tests (#4317 flush-left line, #1934, #3605): pass. tools.shell-shard-4317.test.js fails 2 tests on Windows on
  main and here alike (not in the Windows CI selection).

## Rejected
- Sending `npm test` to tools/windows-tests.js on Windows: it runs a chosen subset, so `npm test` would quietly mean less.
- A Windows branch around the node --test line: #4317 pins that line directly under `if [ "$KOSMOS_TEST_PART" != shell ]`.
- Porting the per-file watchdog to Windows: it needs a process table Git Bash does not give; it was never on here.

## Weakest part
The function is found by the file list appearing in node's arguments; a run whose KOSMOS_TEST_FILES is empty, or whose
first and last files also appear as options, would run unchunked (the first just runs node as before). And the full
suite has not been run to the end on Windows: many POSIX-only files fail there, which is the next job, not this one.

## Review rounds
- Round 1: no BLOCKER (reviewer ran the whole script with a logging stand-in: 1,844 files once each over 3 chunks, a
  failing chunk made the run red, other node calls untouched, nothing left running). 4 WARNINGs, 1 NIT, all FIXED:
  _RT_WIN=0 before the case so the environment cannot set it on a Mac; a chunk ending from a signal (128+, Ctrl-C) stops
  the rest; a test failure outranks a 126/127 from another chunk, so the "not a failing test" line stays true; the skip
  message names the suite queue and cap too; the cap assertion is exact (24,000). Negative control: the 2 new tests fail
  on round 0. 5/5; full script with the stand-in: 3 chunks, all files.
- Round 2: 1 BLOCKER, 1 WARNING, 1 NIT. BLOCKER FIXED (reproduced by the reviewer): run-tests.sh runs under set -u, and
  a run that fit in one chunk read rc before any chunk set it, so every --only run on Windows ended with "rc: unbound
  variable" and ran nothing; rc starts at 0 and the last chunk is decided by the chunk count. The test now runs the
  block under set -uo pipefail with a one-chunk case (both fail on round 1). WARNING FIXED: --test-reporter-destination
  is named as written again per chunk. NIT FIXED: the comment says why 24,000 (headroom under 32,767). End to end with
  the stand-in: --only runs its one file in 1 chunk, exit 0; the full node part 3 chunks, 1,844 files. 6/6.
- Round 3: 2 BLOCKERs, 1 WARNING, 1 NIT, all FIXED (node() rewritten whole). BLOCKER: under set -u, bash before 4.4
  (a stock Mac's 3.2) calls an empty array unbound, so the new test would go red there; every array in node() is now
  read as ${x[@]+"${x[@]}"} (pinned by a source check; no bash 3.2 on this box to run it). BLOCKER: a test file named
  after the suite's files ran once per chunk (3 times); trailing arguments are now split: one equal to a listed file is
  dropped (it runs in its chunk), an existing file goes with the last chunk only, anything else (options and their
  values) with every chunk. WARNING: a run stopped by a signal says "stopped after N chunk(s) (exit E): M of T file(s)
  not run". NIT: 126/127 (node cannot run) stops the rest too. End to end with the stand-in: full 3 chunks/1,844 files,
  --only 1/1, a named file once. 8/8; the new tests fail on round 2.
- Round 4: 1 BLOCKER, 1 WARNING, 2 NITs, all FIXED. BLOCKER: a trailing argument in another spelling (./x) or a glob
  ran once per chunk, or reran files an earlier chunk ran (one node --test runs each once). Simplified instead of
  patched: on Windows an option, and the word after an option without =, go to every chunk; a word naming a listed file
  in any spelling (./x, the repo's own path) is dropped; anything else (another file, a glob, a folder) is refused with
  "Name them with --only" before any chunk runs. WARNING: one file over the cap left an empty last call, and node --test
  with no files runs every test; there is never a call with no files now. NITs: the reporter warning reads options before
  the files only; the not-run count has no trailing files to miscount. End to end with the stand-in: full 1,844 once,
  ./engine/tasks.test.js once, --only once. 9/9; the new tests fail on round 3.
- Round 5: 1 BLOCKER, 1 WARNING, 1 NIT, all FIXED. BLOCKER: "the word after an option" took a file after a FLAG
  (--test-only engine/x.test.js) for the flag's value, so it went to every chunk (and a glob there too). Now only options
  that take a value (a fixed list: the name/skip patterns, concurrency, reporter, reporter destination, shard, timeout,
  import, require, loader, conditions, env-file) keep the next word; after any other option the word is checked as a
  file (dropped if listed, refused otherwise). WARNING: the reporter-destination warning read the runner's own options,
  so it never fired for the user's; it reads the user's now. NIT: the comments say what the code does. No caller in the
  repo passes run-tests.sh node arguments (package.json, workflows, queued-heavy.sh). 10/10; the new test fails on
  round 4.
- Round 6: no BLOCKER (common paths end to end: plain run 3 chunks/1,844 files once each, a red chunk reaches the
  machine-naming block, --only with ./spelling once, non-test node calls untouched; macOS/Linux untouched; 3.2-safe by
  reading). WARNING: on Windows the suite queue and cap are off, so two runs can overlap (no regression: before, none
  ran) -> DEFERRED to #7334, named in the skip message. NITs FIXED: the stand-in uses #!/usr/bin/env bash; the #7262
  comment in windows-tests.js is kept (it was wrong since #7318: its tool-guard arms run on Windows), said in the commit.
  Converged.
