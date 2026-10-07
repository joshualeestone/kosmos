# #5500 slice 1: engine/create.test.js's Linux-skipped fixture tests run on Linux

Card: joshualeestone/kosmos#5500. Stacked on linuxskip-5432 (#5502, reviewed, waiting on CI); rebased onto main when
it merges. Other files on the card are later slices.

## Finished looks like
The 39 tests in engine/create.test.js that #5432 skipped on Linux with LINUX_UNPORTED_WHY (launchd was only their
fixture) run on Linux and pass, assert the same thing on macOS as before, and the constant is gone. Measured with
process.platform forced to linux (forcelinux.js): 223 tests, 191 pass, 0 fail, 32 skipped (was 71 skipped). macOS:
223 pass, 0 skipped.

## Approach
- The job is read through the platform's own file: jobfixture.jobPath, plus test helpers jobText, jobStrings (plist
  <string>s / unit ExecStart args and directive values), jobEnv (plist key / unit Environment=), plannedModel
  (create.plannedModelArg on macOS; create.readJob(name).model on Linux, the same argument slot; plannedModelArg has
  no production caller).
- Runner stubs answer systemctl as well as launchctl: startsJob (bootstrap / systemctl start), unloadTarget (bootout /
  systemctl stop), jobLabel, notAReadOrPrep (Linux reads and prep: is-active, show-user, daemon-reload, enable,
  enable-linger). On macOS each helper is exactly the check it replaced.
- Two tests assert a sentence that differs by platform (a loaded job with nothing on disk; setAccount on a name with
  no job). The macOS assertions are unchanged; on Linux each asserts Linux's own sentence (create.js 4858 and 1234),
  which no test checked before. The loaded-job test keeps its control on Linux too.
- Every replaced assertion is one for one (35 removed, 35 added); none was dropped or loosened.

## Rejected
- Keeping the two sentence tests skipped: their Linux sentences were untested anywhere (checked by grep).
- A second copy of the file for Linux: the tests would drift.

## Weakest premise
Forced Linux is process.platform set to linux on this Mac, not a Linux host: paths, systemctl and loginctl are
stubbed by the tests either way, but a real Linux runner can differ (temp dirs, line endings). The Linux CI lane is
the real check (a linux-ci-* push), and it runs before merge.

## Validation
create.test.js on forced Linux and macOS as above; the file-scanning guards 67/0.
