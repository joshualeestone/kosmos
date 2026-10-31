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

## Review 1 (decided)
1. shell-parallel.sh's stop now really TERMs, then KILLs, a live shard's group on Windows. Kept (the Mac behaviour,
   and `ppid == $$` keeps it to this shell's own children). New arm: in a shell that sourced the lib, the stop ends this
   shell's own group-leading child and leaves a group-leading process this shell did not start, though both are in
   the list. Fails with origin/main's lib (the own shard is not stopped).
2. The Windows ancestor answer is now also kept in a file, `<marker dir>/winanc/<msys pid>.<windows pid>.<start ms>`,
   because the fixture filter runs on the right of a pipe and each wait poll runs its check in a `$( )`, so the
   shell-only cache died every poll. Keyed by the process's start, so a recycled pid never reads another's answer;
   files of gone pids are removed whenever one is written (no EXIT trap, so no caller's trap is touched). Chosen over
   computing verdicts before the pipe, which would mean editing the shared Mac pipeline in cut-guard.sh. New arm: a
   stand-in powershell.exe is asked once across two subshells (twice without the file), and a gone pid's file is
   removed. Measured, kosmos_refuse_if_suite_live with one foreign suite, four polls each in its own `$( )`:
   before 4117 / 3052 / 3199 / 3216 ms, after 3836 / 2844 / 2772 / 2716 ms (the PowerShell call, about 0.4 to 0.5 s,
   is gone from every poll after the first; the rest is the shared code's per-hop ps forks, which Git Bash makes slow).
   Weakest part: a same-user process could plant a file saying a real suite is under node --test, so it is not
   counted; the same user can already set KOSMOS_TESTS_IGNORE_SUITE=1, so it opens nothing new.
3. Every word of a command line now reads backslashes as slashes (not only argv[0]), so `bash C:\...\tools\run-tests.sh`
   is a suite the name arm sees. New arm: such a stand-in is seen; without the change it is missed.
4. A failing PowerShell walk for a bash under node --test leaves the list short, so that run counts as real (a fixture
   counted as a live suite: the guards over-refuse, the safe direction). Partly mitigated by the kt-sandbox cwd rule,
   which now reads /proc/<pid>/cwd through the lsof function, so a fixture working in a run-tests.sh sandbox is still
   dropped.

## Review 2 (decided)
1. pgrep -fa now exits 2 (could not tell, so the guards refuse) when a process is still in /proc but its command line
   cannot be read or is empty, after a second read (a process can be caught mid-start); a process gone since the
   listing is still skipped. `_kosmos_win_cmdline` returns 1 for gone and 2 for unreadable so the two are told apart.
   Weakest part: a real process that is always unreadable (an elevated Git Bash beside an unelevated run) now makes
   every check here refuse until it exits; that is the fail-closed side the review asked for, and none was seen on
   this box (every /proc entry readable over five sweeps; an exited child leaves /proc at once). Test seam
   KOSMOS_WIN_CMDLINE_UNREADABLE_PID (it can only make a guard refuse more). New arms: pgrep exits 2 and the suite
   check refuses "could not tell"; the seam naming a gone pid changes nothing.
2. An unquoted Windows command line whose first word is not a .exe takes the words up to the first one that is, so
   `C:\Program Files\nodejs\node.exe --test` reads as node --test. No later .exe, or words split by more than one
   space: the first word, as before. New arm, with a control for a plain path.
3. An empty answer from PowerShell is kept only when the walk saw the first parent (it prints a marker line then);
   otherwise it is asked again on the next check rather than kept for the process's life. New arm.
4. The start time is read from /proc/<pid>/stat after the last ") ", so a program whose name has a space keys its cache
   file by its real start. New arm (a copy of perl named "pe rl.exe").
5. pgrep exits 2 when /proc/[0-9]* matches nothing (unreachable while this subshell is itself listed; not testable).
   The winanc pruning stays as it is: files of gone pids are removed only when a new answer is written, so a quiet box
   keeps a few small files until the next write; no reader trusts one, since the name carries the process's start.

All four testable arms fail with e6f24b7cfd's lib (5 reds) and pass with this one.

## Review 3 (decided)
1. The PowerShell walk runs under `timeout -k 2 10` (Git Bash's /usr/bin/timeout; a native powershell.exe is ended at
   the limit, measured 2.2 s for a 2 s limit). A call that times out or fails in any other way counts as no answer:
   what it printed is not used and nothing is kept, so the run counts as real. Without timeout(1) the call is unbounded
   as before. New arm: a stand-in powershell.exe that prints a node --test parent and then hangs 30 s is cut off at
   10 s, its partial answer unused and not kept (with 64d8283aca's lib it took 30 s, read the run as a fixture and
   cached that). The arm costs 10 s of the test's run.
2. Left as it is, with the side effect named here. An unreadable-but-present command line already makes
   `ps -o command=` print nothing, and every caller reads only what ps printed, never its exit status: the run-marker
   check (cut-guard.sh, _kosmos_marker_other_live), the suite-waiter check (_kosmos_suite_waiter_live), the light-side
   intruder check, the ancestor walk here and run-tests.sh's watchdog. So returning 2 instead of 1 would change
   nothing, and making those callers keep a marker on an empty read would change Mac-shared code. The side effect:
   on Windows, a live run whose command line cannot be read (an elevated Git Bash, or the
   KOSMOS_WIN_CMDLINE_UNREADABLE_PID seam) has its run marker or waiter marker removed as stale. Detection still holds
   for the suite and harness checks, because pgrep -fa exits 2 for that process and the guards refuse "could not tell";
   the cost is that such a waiter loses its queue place (it re-marks with its old queue time on its next pass).

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

### Review 4 (no blocker, no warning: converged)
- NIT: `command -v timeout` could find Windows' C:\Windows\System32\timeout.exe (a different program; every walk would fail, over-refusing). Now /usr/bin/timeout when executable, else unbounded as before.
- NIT, accepted: GNU timeout puts itself in its own process group (no --foreground), so a shell-parallel stop of a shard's group leaves a running walk's timeout and powershell.exe alive for at most 12 s (bounded, harmless).

### Round summary (for the proof)
- Round 1: no blocker. [WARNING] new Windows shard-stop kill path untested --> FIXED: test (own shards stop, an outside process lives). [WARNING] PowerShell answer lost per pipe subshell --> FIXED: file cache keyed pid+winpid+start. [WARNING] backslashed script paths missed (fail-open) --> FIXED. [NIT] walk failure counts the run real --> documented.
- Round 2: no blocker. [WARNING] an unreadable command line of a listed process skipped silently (fail-open) --> FIXED: pgrep exits 2. [NIT] x4 --> FIXED (spaced unquoted path, empty answer caching, stat parsing, empty glob).
- Round 3: no blocker. [WARNING] PowerShell walk unbounded (a wedged WMI hangs the queue) --> FIXED: timeout -k 2 10, test. [NIT] unreadable `ps -o command=` reads as gone, removing a live marker --> DOCUMENTED (no caller reads the status; changing callers means Mac-shared code).
- Round 4: no blocker, no warning. [NIT] timeout.exe on PATH --> FIXED. [NIT] timeout's own process group --> ACCEPTED.
