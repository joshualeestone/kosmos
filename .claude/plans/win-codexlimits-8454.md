# win-codexlimits-8454: a moved Codex agent's job time on Windows (kosmos#8454)

**Posture:** production

## Problem
The board's codex-limits walk (server.js) shows an OpenAI account's usage limits from its own folder and from each of
its agents' private Codex homes, counting an agent's reports only since its job last changed: a move between accounts
rewrites the job, and the private home still holds the old account's sessions. It read that time from the job's file:
the systemd unit on Linux, and create.plistPath everywhere else. On Windows the job is a Scheduled Task and no plist is
ever written, so the stat always failed, nothing was filtered, and a Codex agent moved to another account showed its
old account's limits on the new one.

Its test (server.codexlimits-6176 "a moved agent") passed on Windows only because the old job fixture wrote a plist
there too; since #8460 (the stand-in Task Scheduler) it failed honestly.

## Change
- engine/win32job.js: taskFilePath(name, worldId), the file Task Scheduler keeps a registered task in
  (%SystemRoot%\System32\Tasks\Kosmos\agent-<key>), the sibling of linuxjob.unitPath. A sandboxed board
  (AGENT_WORKFORCE_LAUNCH) uses <launch>\win32-tasks instead, as linuxjob keeps its units in the sandbox.
- server.js: on win32 the codex-limits walk stats that file.
- test-support/jobfixture.js: the stand-in Task Scheduler names its files as Task Scheduler stores them
  (win32-tasks/Kosmos/agent-<key>, no .xml), so a test that moves a job's time moves the file the board reads.
- engine/win32job.taskfile-8454.test.js: the path, unsandboxed and sandboxed, and per world.
- tools/windows-tests.js: server.codexlimits-6176 joins ALSO_ROOT (the new test is selected by its win32 name).

## Evidence the design holds on a real Windows box (probed 2026-11-12, on the card)
- A non-elevated process (IsInRole Administrator = False) can stat the task files: the registering user owns them.
- schtasks /Create /F (what every rewrite of an agent's job does) rewrites the file: a throwaway task registered twice,
  3 s apart, moved its time from 09:52:29.74 to 09:52:33.02. The probe task was deleted.

## Decided, not missed
- The file time, not a <Date> in the task's RegistrationInfo: the time exists for every task already registered, needs
  no change to what Kosmos registers, and is what the platform itself updates on re-registration.
- A task file the board cannot stat is not filtered, as before (a missing meter, never a wrong one, is the existing rule
  for an unreadable time).
- The weakest part: the time also moves on any re-registration (a rename, a model change), which hides the agent's
  reports until Codex reports again. That is the rule the macOS and Linux arms already follow (the code's own comment
  says so).

## Measured on the Windows box
server.codexlimits-6176 8/8 (was 7/1); negative control: with server.js reverted alone, "a moved agent" fails again.
win32job.taskfile-8454 3/3. The 68 files that use the job fixture: 148 Windows failures (149 before), and the only
difference is the codexlimits test, now passing. Policy tests pass.
