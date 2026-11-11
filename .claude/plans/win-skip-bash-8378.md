# win-skip-bash-8378: the first #8378 cluster, tests that need bash, skip on Windows with their reason (kosmos#8378)

**Posture:** production

## Problem
#8378 (phase 2 of #8368): on a Windows computer the full suite is red on main for macOS and Linux reasons. The largest
cause is tests that spawn bash (`/bin/bash`, `/bin/sh`, a bare `bash`) or `install/kosmos`, the Mac and Linux CLI, which
Windows does not have. Test hygiene, done now because the Windows product queue is waiting on tonight's build.

## Change
- `test-support/skip-on-win32.js`: `skipOnWin32(reason)` is the reason on Windows and `false` elsewhere, so a test
  skips only on Windows and node:test prints why. An empty or missing reason throws. Its own tests:
  `test-support.skip-on-win32.test.js` (4).
- 21 test files: each test that fails on Windows only because it spawns bash gets `{ skip: SKIP_BASH }`, with a reason
  that names what it runs (the supervisor script, the kill guard, install/kosmos, run-tests.sh, a fake tmux script).
  Where a file loops over the bash CLI AND the Windows CLI (cli.inputkeep-6774, cli.limitmsg-5805, cli.whoisleft-8137,
  cli.livecheck-prefix-8156), only the bash half skips; the Windows CLI's tests still run on Windows.
- Nothing changes on the Mac or Linux: the helper is `false` there.

## How the set was chosen
From the #8368 inventory (main 53a164708d, every file run alone on the Windows box), the files whose EVERY failing test
fails for the bash reason (23). Re-measured on current main (545df024be) and every failing test's first error line read
before skipping. Left out:
- `bundle.manifest.test.js`: its one failure is the POSIX executable bit (the file-modes cluster, a later PR).
- `install.boot-adds-5584.test.js`: a real assertion (a board start on Windows adds files the install gate does not
  expect). That is something to look at, not to skip.

## Result (each file run alone on the Windows box, the no-schtasks preload)
Before: 21 files, 345 failing tests on Windows (plus the two left out). After: 0 failing in those 21 files; every pass count is
unchanged (no test that passed is now skipped); those 345 tests skip, each printing its reason.

## Weakest premise
That every skipped test is ONLY about bash. Each was checked by its first error line (ENOENT for bash or sh or
install/kosmos, a fake tmux shell script EFTYPE, "neither /bin/bash nor /bin/zsh exists"). A test that also covers a
Windows behaviour behind its bash call would lose that coverage on Windows; none of the 21 files is a win32 file or in
the Windows CI job's list, so the Windows CI job is unaffected either way.

## Not covered (later #8378 PRs)
tmux, POSIX modes, signals, and the ~1,900 plain assertions; the stray `board.agent-claim` / `board.person-start` files.
