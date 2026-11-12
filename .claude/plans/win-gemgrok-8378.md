# win-gemgrok-8378: the Gemini and Grok install tests on Windows (kosmos#8378)

**Posture:** production

## Problem
engine/runners.gemini-grok-3713.test.js fails 11 of 12 tests on Windows. Every failure is the fixture calling
/usr/bin/tar, which Windows does not have. Behind it: most tests pass platform 'darwin' or 'linux' to install() on
purpose, so they run the macOS and Linux install pipeline (/usr/bin/tar, a symlink or a #!/bin/sh launcher as the
stable path, fixture programs run by their shebang line), which does not exist on Windows. The Windows install path has
its own tests, engine/runners.win32-gemini-grok.test.js (11/11 on the box). No production bug.

## Change (test-only)
- Eight tests whose subject is the macOS or Linux pipeline skip on Windows, each with its mechanism (skipOnWin32).
- Three tests run the Windows install path on a Windows host (the same claim, in Windows terms): a Grok download that
  will not expand is refused; a node that is gone reads missing; mid-prove the runner reads absent and installing (on
  Windows grok.exe exists but has no verified marker yet). macOS and Linux lines are unchanged.
- Cleanup through test-support/remove-tree.js. The file joins ALSO in tools/windows-tests.js.

## Decided, not missed
- Skips rather than Windows arms for the eight: their Windows counterparts already exist in
  runners.win32-gemini-grok.test.js, so a second copy here would test the same arm twice.
- Not carded, production cannot reach it: a Windows Gemini install given a node path that does not exist passes its
  prove through the fallback to the board's own node and gets its marker, then reads absent. Production always records
  process.execPath, which exists.

## Measured on the Windows box
Before 1 pass / 11 fail; after 4 / 0 / 8 skip. On main the file never downloaded from npm on Windows (every test died
at the fixture first); now every install() call has a stub download. Other runners files unchanged
(win32-gemini-grok 11/11, win32-codex 15/15, pathext-win32-570 6/6, win-runnable-2270 2/2, linux-5419 7/7). Policy tests
pass.

## Review log
- Round 1 (no blockers or warnings, 1 convention, 2 nits). Fixed: the gone-node test's title also claimed that Kosmos's
  runtime node beside the runners folder revives the launcher, a half its Windows arm never ran, so a Windows run
  reported that claim green unchecked. Split in two: "reads missing, and Connect reinstalls it" runs everywhere; the
  runtime-revive half is its own test (it installs with the board's node first, the state the old half started from),
  skipped on Windows with its mechanism. Box: 4 / 0 / 9. Nits not changed: a nodeBin that names a missing node would
  install and read absent on Windows (no production caller passes nodeBin); the Windows arm copies node.exe (about
  80 MB) into the sandbox.
