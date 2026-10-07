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

## Slice 2: the server and create test files on the card
The card's other 13 files (server.test.js and 12 more) skipped about 39 tests on Linux for #5500; all now run on
forced Linux and pass on macOS (per-file counts: every file 0 skipped on both). test-support/jobfixture.js gains
systemdStub(): a stand-in for systemd that remembers what it started and enabled and answers is-active, is-enabled,
the unit listings and linger; anything else returns null, so on a Mac every call falls through to the test's own
fake. Where a sentence differs by platform the macOS assertion is unchanged and Linux asserts its own sentence
(setprovider-writes-2811: create.js 1283). offline-nextmove's child board pins linger on (in the child only), else its
sentence would follow the host machine. Removed assertions 11, added 11, one for one.
Residual: systemdStub reports a failure by returning { ok:false }, as these files' fakes do; create's real runner
throws instead. Both reach the same result inside create's systemd wrapper.
Not this slice: create.test.js's LINUX_UNIT_UNTESTED_WHY and LINUX_TASK_STUB_WHY skips (the card's comments).
Review 2 (accepted gap): systemdStub answers start/stop/enable/disable ok for a unit with no file (real systemctl
exits 5) and says "disabled" for an unknown unit (real systemd: empty, enabledState known:false), so tests using it
never reach linuxjob's not-loaded or unknown-enabled paths. Those are tested in engine/linuxjob.test.js.
Review 2: the will-not-unload test on Linux also asserts the unit was disabled (linuxjob.remove stops, disables, then
reports the failed stop), so its Linux arm is the same disabled-but-still-running state as on macOS.
