# winwd-9278: a per-file watchdog for Windows (kosmos#9278 step 2)

Stacked on wintmp-9278 (PR #9304, step 1). Card comments 7237714884 (findings) and 7239151355 (design, measured).

## Finished looks like
`npm test` on Windows (Git Bash) stops a test file stuck in a sync call at the per-file limit, names it, and the run is
red, as on a Mac; a file that ends normally beside it is not named; the Windows CI job runs that case through the real
runner (tools.run-tests-winwd-9278.test.js in ALSO_ROOT). Mac and Linux start the same loop as before.

## Change
- tools/run-tests.sh: rt_wd_snap_win (one Get-CimInstance snapshot: pid, parent, age, start time, command line; cut at
  20 s by timeout) and rt_wd_loop_win: node --test found through /proc/<pid>/ppid and cmdline, its winpid from
  /proc/<pid>/winpid; it follows each #7257 chunk's node --test in turn; a child of node over the limit whose command
  line mentions node is stopped with taskkill /T /F, and only when that succeeds is it printed with the Mac loop's
  TIMED OUT line and added to the flag file; each file is keyed on pid and start time (a failed taskkill is retried at
  the next look); an empty snapshot is said once and the limit is not claimed while it lasts (.node removed).
  rt_file_watchdog_start starts it when _RT_WIN=1, and says so and starts nothing when powershell is missing. The
  Windows start line says only that the leftover-process checks and stops do not run there. The guard step 1 put on
  the Mac loop's not-found line is removed (the Mac loop no longer runs on Windows).
- tools.run-tests-winwd-9278.test.js: which loop starts where (source); on Windows, the real runner on a stuck file and
  a quick one with a 30 s limit; and 116 long-named quick files over two or more chunks with the stuck file last.

## Measured (Windows runner, never-merge branch angel-9278-never-merge)
- Pass 7: the runner stopped the stuck file at the limit (41 s total), named only it, run red, no node left.
- Pass 9: the new test file passes on Windows (stopped after 40.9 s with a 30 s limit).
- Pass 8 (before the env fix): an inner run under node --test with NODE_TEST_CONTEXT set reports to the outer one and
  exits 0; the test now drops it, as tools.run-tests-file-timeout-6668 does.

- Pass 11: both Windows arms pass (40.1 s; 116 files, 48.0 s).
- Controls: with the Mac loop forced on Windows both arms went red ("not stopped by its own watchdog"); with the loop
  ending after the first chunk the chunk arm went red (its timeout is now checked before the chunk count, so it names
  that failure).

## Rejected
- Porting the leftover-process checks and stops (#4273, #8890, #9159) in the same change: they need the same snapshot
  but kill by command line under the run root; a separate step, so this one stays reviewable. Still said at the start.
- A shim twin (Volta's non-exec node) on Windows: not seen on a Windows box yet.

## Weakest premise
That node --test's per-file children are direct children of node.exe on Windows (true in every measured run on Node 26).
A file whose command line does not end with a listed name is named by its last word (a quoted path with a space keeps
its quote); the measured arms use absolute paths, so the relative-name branch is not exercised there.
