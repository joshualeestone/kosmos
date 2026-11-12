# win-fixtures-8378: shared Windows test fixtures (kosmos#8378, triage step 4)

**Posture:** production

## Problem
Nine heavy test files fail on Windows (server.test.js, server.disconnect-stop-2570, web.not-running, engine/discover.adopt,
qwen-review2-5977, machine, register, delete-leftover, connect-keep-8293), most of them for the same few fixture reasons,
not for anything about the code under test:
- The agent's job. test-support/jobfixture.js wrote a plist (macOS) or a systemd unit (Linux). On Windows the job is a
  Scheduled Task, which create.readJob reads through win32job (`schtasks /Query /XML`); a test never reaches the real
  Task Scheduler, so every seeded agent read as having no job, and every create failed.
- Runner stubs. Tests pointed AGENT_WORKFORCE_<RUNNER>_BIN at an extensionless `#!/bin/sh` file, or at /bin/echo or
  /bin/sh. Windows runs a file by its extension (PATHEXT), so runners.isRunnable refused it, and create or adopt answered
  "Claude is not installed".
- The roster. Some tests made a fake tmux (a shebang script) print the pane lines; Windows cannot run it.
- os.homedir() reads USERPROFILE on Windows, not HOME, so a sandboxed HOME was ignored.
- The PATH separator was written as ':'.

## Change (test-only; no production code)
- test-support/jobfixture.js: a Windows arm. jobPath / jobFor write a task definition (the text win32job.taskXml writes)
  under AGENT_WORKFORCE_LAUNCH/win32-tasks, and install a stand-in Task Scheduler through win32job's own seams
  (setRunner, setAnchorer). It answers the schtasks calls win32job makes (/Query /XML, /FO LIST, the /FO CSV lists,
  /Create, /Delete, /Change, /Run, /End) from those files. /Run writes the ownership row the agent's supervisor would
  write. useJobStore() installs it for tests that let create write the job. macOS and Linux are unchanged.
- New test-support/runnerstub.js: writes the stub at the same path, plus a `.cmd` beside it on Windows (what runners.js
  finds for a bare path there); removeRunnerStub removes both.
- Per file: USERPROFILE beside HOME, node (process.execPath) in place of /bin/echo or /bin/sh where a runnable stand-in
  is needed, the pane source the Windows board itself uses (status.setPaneSource) for the roster, and on Windows only
  (macOS and Linux still read the roster through the fake tmux), path.delimiter for PATH.
- Skips on Windows, each naming its mechanism: a tmux stop (kill-session/has-session), launchctl/launchd, POSIX modes
  (chmod), the macOS LaunchAgents survey, a #!/bin/bash sign-in mock, the macOS arm Kosmos uses for DeepSeek/GLM/Qwen
  (refused on Windows).
- engine/startplugins-5774: its macOS-arm test writes the plist path directly on Windows (it reads DEPS.platform darwin).
- tools/windows-tests.js: the seven engine files join ALSO, and server.test.js, server.disconnect-stop-2570 and
  web.not-running join ALSO_ROOT, so the Windows CI job runs them.

## Decided, not missed
- server.codexlimits-6176 "a moved agent: a report from before its job last changed does not count" now FAILS on
  Windows, and is left failing. It passed before only because the old fixture wrote a plist on Windows too, and
  server.js reads the job's change time through create.plistPath. That is a real Windows bug, filed as #8454. A skip
  would hide it. The file is not in the Windows CI selection.
- machine.test.js's installedCheck tests now pass platform 'darwin' explicitly. installedCheck takes the host platform,
  and on Windows it requires no tmux, so the tmux arms are the darwin arm's. On macOS that is the host value, and on
  Linux installedCheck answers exactly as for darwin.
- machine.test.js and server.test.js use node (process.execPath) as the runnable stand-in on Windows. machine.test.js
  uses it on every platform (it only has to be a real executable).

## Measured on the Windows box
Every test file that uses jobfixture, plus each changed file (68 files), run on main (8329d6df70) and on this branch.
Failures went from 477 to 149, compared by test name. The one test failing here that passed on main is the
codexlimits-6176 test above (#8454). The nine target files are at 0 failures:
server.test.js 47 -> 0 (8 skip), server.disconnect-stop-2570 33 -> 0 (6 skip), web.not-running 20 -> 0,
discover.adopt 24 -> 0 (4 skip), qwen-review2-5977 17 -> 0 (6 skip), machine 25 -> 0 (15 skip), register 24 -> 0 (18 skip),
delete-leftover 16 -> 0 (10 skip), connect-keep-8293 20 -> 0. create.compat-7206 is 9 -> 0 (6 skip).
33 other files improve as a side effect (the status.*-ring/observed files, server.whoami-*, server.*-badge-*, and others),
and 11 files keep some Windows failures for other causes, left to later triage steps.

## Review log
- Round 1 (no blockers, 5 warnings, 3 nits). Fixed: two server.test.js cleanups now ask for the job path again (the
  fixture's own rule); the stand-in's anchorer is installed on every call; /Run refuses a switched-off task; /Change
  writes the switch even into a definition without one (Task Scheduler always keeps it); the header says the step forms
  (installSteps and the rest, through engine/remove.js's runner) are NOT served. Three skips whose subject does exist on
  Windows (#2615 removed list, adopt #1349 and #1363) name their follow-up card, kosmos#8456. Left as nits: jobFor on
  Windows puts the current world on the task line (nothing reads it yet), and machine.test.js #2304 could assert the
  Windows fallback instead of skipping.
- Round 2 (no blockers, 3 warnings, 3 nits). Fixed: jobfixture now watches win32job.setRunner from the moment it loads
  and refuses (throws) rather than replace a runner a test installed of its own; engine/create.test.js and
  engine/status.test.js install theirs before requiring the fixture, where it cannot see them, and say so at their call
  sites. machine.test.js: the two chmod-000 tests ("a binary we cannot LOOK at", "an unreadable REQUIRED probe"),
  which returned early on Windows and asserted nothing, skip there. "something at the path is not the same as something
  we could run" keeps running on Windows on purpose: there a file with no runnable extension is the same claim, present
  but not runnable, and its folder arm is real. server.disconnect-stop-2570 sets USERPROFILE beside HOME. Nits: the
  server.test.js liveness-probe comment says what node answers on Windows; a declaration moved; the header says the
  stand-in answers in UTF-8, so win32job's UTF-16 decode is not exercised here. 68-file re-run: still 149, only #8454 new.
- Round 3 (no blockers, 1 warning, 3 nits). Fixed: ten more skips whose subject exists on Windows (the create route's
  record, the removal and put-back routes, the removed list's fields, the model and restart routes, and the four #2570
  disconnect-and-stop tests) now say so and name kosmos#8456, where they are listed. The /Change rewrite uses a function
  replacement, so no $ pattern in a definition is read. Left as nits, by design and documented: machine.test.js skips
  the whole app-location test for its one chmod arm; /Run always writes the ownership row, so no test here covers a
  supervisor that never comes up; jobPath resets setLiveness and setRunningClock through setRunner (a test that set
  either first would fail loudly, never pass falsely).
