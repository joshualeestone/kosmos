# wintmp-9278: run-tests.sh on Windows keeps tests' temp files in the run root, and says what does not run there

Card: kosmos#9278 (measured findings on comment 7237714884). This is step one of two; the card stays open.

## Finished looks like (this PR)
On Windows (Git Bash), a test's os.tmpdir() is the run's temp root, so the root's removal at exit and the temp leak
check hold its files; and the runner says once, at the start, that the per-file limit and the leftover-process check
do not run there. Mac and Linux unchanged (both lines sit behind _RT_WIN, set only in the MINGW/MSYS/CYGWIN case).

## Measured (Windows runner, never-merge branch angel-9278-never-merge)
- Without the change: os.tmpdir() was C:\Users\RUNNER~1\AppData\Local\Temp (run 46133530803).
- With it: os.tmpdir() is ...\Temp\kt865 (the run root), and a folder of a new family left on purpose is reported as
  a #4273 LEAK, rc 1 (run 46134195771); the new line prints on a hung-file run.
- Watchdog and process check: Git Bash has no pgrep; its ps refuses -A -o. A file stuck in a sync call ran to the
  outer timeout with a 30 s limit.

## Change
- tools/run-tests.sh: export TEMP and TMP with TMPDIR when _RT_WIN=1; one stderr line in rt_file_watchdog_start when
  _RT_WIN=1 (after the shell-only return).
- tools.run-tests-wintmp-9278.test.js: both lines cut from the script and run in bash with the flag set and not set;
  their place in the script.

## Rejected
- Not starting the watchdog on Windows: its flag files feed the reporting after node exits; leaving it running
  changes nothing there, and a later Windows snapshot can switch it on.
- Building the Windows process snapshot now (Get-CimInstance, about 390 ms, plus /proc/<pid>/winpid): step two on the
  card, a larger change to the watchdog and the leak guard.

## Weakest premise
That npm test on Windows matters (CI's Windows job runs tools/windows-tests.js, not run-tests.sh). And a Windows npm
test may now go red on temp families that leak there and are not on the allowlist: that is the check working, but it
may be news to the first person who runs it.
