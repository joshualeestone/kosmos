# suite-queue-win-7334: the live-suite and install-harness checks, and the suite queue, on Windows (kosmos#7334)

**Posture:** production

## Problem
Since #7257 `npm test` (tools/run-tests.sh) runs on Windows, but there it switches off the live-suite check, the suite
queue with its KOSMOS_SUITE_MAX cap, and the install-harness check (`_rt_suite_check=0; _rt_harness_check=0`, with a
"not run on Windows" line). The guards in tools/lib/cut-guard.sh and tools/lib/process-fixture.sh read the process
table with `ps -o <field>= -p <pid>` (ppid, pgid, command, lstart), `pgrep -fa <ERE>` and `lsof ... -d cwd`. Git Bash's
ps takes none of those options and Git Bash has no pgrep or lsof, so every check exited "could not tell" and refused
every run. With the checks off, two `npm test` runs on one Windows box run side by side with no queue.

Finished means: the suite and harness probes answer on Windows; two runs on this Windows box queue as on a Mac
(measured); the "not run on Windows (#7257)" line is gone; Mac and Linux behaviour is unchanged.

## Design
Git Bash keeps its own process table in /proc: pid, ppid, pgid, the command line (NUL-separated argv), the cwd and the
start time (the /proc/<pid> stamp, to the second, the same on every read) of every MSYS process and of every Windows
program an MSYS process started. It is in the SAME pid space as `$$`, `$!`, `kill -0` and the run-marker file names,
which is the pid space every guard compares, and it is read with shell builtins, without starting a process.

So process-fixture.sh (which cut-guard.sh sources first, and which queued-heavy.sh already tracks with cut-guard.sh)
reads Windows once from `uname -s` (MINGW, MSYS, CYGWIN: the same test run-tests.sh uses for `_RT_WIN`; the flag is
assigned, never read from the environment) and on Windows only defines `ps`, `pgrep` and `lsof` as shell functions
that answer exactly the forms the guards use from /proc and hand every other form to the real program:
- `ps -o ppid=|pgid=|command=|lstart= -p <pid>` and `ps -ww -o command= -p <pid>`;
- `pgrep -fa <ERE>`: "pid command" per match, leaving out its own subshell as pgrep leaves out itself (the caller's
  ancestors are dropped by `_kosmos_pgrep_cmdlines`, as on Linux); exits 2 when /proc cannot be read, so the guards
  refuse ("could not tell") exactly as they do on a Mac when pgrep fails;
- `lsof -a -p <pid> -d cwd -Fn`: the cwd from /proc/<pid>/cwd, for the kt sandbox rule.
A Windows program's argv[0] (C:\...\node.exe) becomes its bare name without .exe, so the guards' `([^ ]*/)?` path rules
and the `${1##*/} = node` test read it.

The one thing /proc cannot see: a Windows program no MSYS process started (npm's cmd.exe, the per-file node of a
node --test runner) is not in it, so a bash started by one has /proc parent 1. Only the node --test ancestor rule (a
suite or harness inside a test is not a separate run) needs to see past that. When the MSYS walk in
`_kosmos_pid_has_node_test_ancestor` ends at parent 1, `_kosmos_win_native_ancestors` makes ONE PowerShell call
(Get-CimInstance Win32_Process, walking ParentProcessId, stopping at a parent created after its child, a reused pid)
for the remaining ancestors' command lines, and caches the answer per process for that shell, so a check pays one call
(about 0.5 to 1 s, measured) per other live tree, not per subshell. A failed call leaves the list short, which reads as
"no node --test ancestor": counted as a real run, the side the guards already take.

run-tests.sh then drops the Windows block that switched the two checks off; the queue, the cap and both checks run
there as on a Mac.

Why this: no new state (no lock file the runner must hold and clean up), the same code path on every platform after
the read, one place to read the table, and no process spawned per read except the one PowerShell call per tree. Mac
and Linux are unchanged by construction: nothing is defined unless uname says Windows, and the one edit in shared code
(`_kosmos_pid_has_node_test_ancestor`) records the last pid walked and adds a branch gated on the same flag.

## Rejected
- A lock file the runner holds (the card's third option): the queue already keys everything (waiter markers, roots,
  self-exclusion) on process-table reads; a lock would be a second, Windows-only queue beside the shared one, and a
  crashed run's lock needs the same liveness read anyway.
- `tasklist /FO CSV`: no parent pid and no command line, so it cannot answer the ancestry or the "is it a run" match.
- PowerShell / Win32_Process for every read: Windows pids are not the pid space of `$$`, `kill -0` or the marker files
  (a bash's MSYS pid differs from its Windows pid, and a cygwin exec changes the Windows pid), and one spawn per read
  is about 0.5 to 1 s, with dozens of reads per check.
- Renaming every ps call site in the libs to a wrapper: it touches the Mac lines, and bash's temporary-assignment rules
  for `TZ=UTC LC_ALL=C ps` through a function would have to be re-proven on bash 3.2.

## Side effects, named
In a shell that sourced the lib on Windows, any caller of one of the answered forms gets the /proc answer too: the one
today is shell-parallel.sh's stop (`ps -o ppid= -p`), which now finds a live shard by its parent and TERMs its group,
as on a Mac (it found none before). run-tests.sh's file watchdog asks `pgrep -P` and `ps -A`, which still go to the
real programs, so it is as before.

## Tests
- tools/test-win-proctable-7334.sh (new): on Windows, the shims answer from /proc for a live and a dead pid, pgrep -fa
  matches and leaves out itself, a bad regex exits 2, a Windows argv[0] reads as its bare name, other forms go to the
  real ps, a bash under `node --test` reads as a fixture (the native leg) and the same bash under plain node does not,
  and a live `bash tools/run-tests.sh` stand-in is seen by the real suite candidates read; elsewhere it checks that
  none of the shims is defined (the gate) and stops.
- Shared guard tests run on this Windows box before and after: tools/test-cut-guard.sh,
  tools/test-running-anchor-5470.sh, tools/test-light-side-4911.sh, tools/test-queued-heavy-4977.sh,
  tools/test-cut-shape-6977.sh, tools/test-prepush-wait-6756.sh (results in the commit message).
- Measured on the Windows box: two `bash tools/run-tests.sh` runs (one small shell shard each, KOSMOS_SUITE_MAX=1 on
  the second) and the second queues and starts after the first ends.

## Measured (Windows 11 box, 2026-10-27)
- Two real runs, `KOSMOS_TEST_PART=shell KOSMOS_SHELL_SHARD=3/200`, the second with KOSMOS_SUITE_MAX=1 and
  KOSMOS_WAIT_EVERY_S=5: A ran 18:24:35.7 to 18:25:29.3; B started 18:24:38.8, said "a test suite
  (tools/run-tests.sh) is already running" and queued at 18:25:04.2, and "the box is clear after waiting 10s; this
  test run starts now" at 18:25:36.7, 7.4 s after A ended. Both green.
- Cost: kosmos_refuse_if_suite_live with one other suite live, about 3.1 s (0.6 s of it the PowerShell call, the rest
  the existing per-hop ps forks, which are slow under Git Bash); the harness check about 0.7 s; a run's own fixture
  check at start about 2 s. Per 30 s poll.
- Shared guard tests on this box, before and after (passes / fails): test-cut-guard 102/84 (timed out at 900 s) then
  149/29 (finished in 848 s); test-running-anchor-5470 20/14 then 30/4; test-light-side-4911 83/14 then 92/4;
  test-cut-shape-6977 24/12 then 32/4; test-prepush-wait-6756 5/0 both; test-queued-heavy-4977 times out both (its
  own pgrep calls). The remaining Windows reds are the tests' own `pgrep -f` / `pgrep -P` calls (not a form the guards
  use, so not answered here), copies of run-tests.sh without tools/windows-tests.js (#7247), and 60 s stand-ins that
  outlive their window on this slower box.

## Not covered
- A Mac or Linux run of the shell tests: not available from this box. The Mac path is unchanged by construction (see
  Design) and the new test file checks the gate.
- Runs not started by an MSYS shell AND not reaching run-tests.sh through bash (there are none: run-tests.sh is a bash
  script) are fine; but a suite whose script path contains a space, or is written with backslashes, is not matched
  (the same gap kosmos_running_lines already names for every platform).
- A second Git for Windows install (a different msys-2.0.dll) keeps its own /proc, so suites started from two
  different installs on one box do not see each other.
- heavy-gate.sh, queued-heavy.sh and release.sh on Windows: they now get the same reads when they source the libs, but
  nothing here measures them there.
