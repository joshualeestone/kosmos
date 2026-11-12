# win-skip-posix-8378: the POSIX-modes and Mac-only cluster of #8378 (kosmos#8378)

**Posture:** production

## Problem
#8378 (phase 2 of #8368), third cluster. The first (PR #8408) added `skipOnWin32` and took the tests that run an
absolute POSIX path or a script by its shebang; the second (PR #8411) took tmux. This one takes four files the
tmux cluster left behind because their failures are not tmux: Linux-only lookup, launchd, /usr/bin/tar, and the
POSIX executable bit.

## How the set was chosen
Re-measured on origin/main 2b3c0c397d on the Windows box (node 24.19.0, TAP), every failing test's error read:
- `engine/create.tmux-linux-4917` ("Linux resolves tmux from PATH before the usual system locations", "Linux ignores
  a present but non-executable tmux"): `linuxTmuxBin('linux', ...)` returns null. It asks
  `runners.isRunnable`, which on a Windows host judges by PATHEXT, so the extensionless fake `tmux` never counts.
  The function only does work when platform is linux; on Windows the code is never reached.
- `engine/connect-oldjob-8294` ("a linked folder, tmux -c in the arguments, a home spelling, and the runner's own
  program"): `foreignStarter` returns null at the "$HOME/agents/homey" arm. `foreignStarter` scans launchd login
  jobs in ~/Library/LaunchAgents (create.AGENTS_DIR), which Windows does not have, and `folderSpellings`
  (engine/register.js) adds the "$HOME/..." spelling only for a folder under HOME + '/', a POSIX separator. The test
  is split: the home-spelling arm is its own test ("a home spelling"), skipped on Windows; the linked-folder, tmux -c
  and runner's-own-program arms keep running everywhere.
- `tools.sbom-o05` ("a tmux bundle entry name with a control character ... refuses", "the command line refuses an
  unsigned manifest ...", "the command line end to end ..."): `readTmuxBundle` runs `/usr/bin/tar` by absolute path,
  which Windows cannot run; that alone stops all three, so it is the reason given. (The control-character fixture
  also names a file with a newline, which a Windows file name cannot hold either.) The SBOM is built only for the
  Mac release.
- `bundle.manifest` ("verify-manifest.sh exists, is executable, and checks ..."): `mode & 0o111` on
  tools/verify-manifest.sh; Windows keeps no executable bit.

## Change
- Skip those arms on Windows with `skipOnWin32` and the reason above; Mac and Linux behaviour unchanged (the
  helper returns false off win32).
- `bundle.manifest` test 4 is split: the executable-bit check becomes its own test (skipped on Windows); the
  existence and content checks keep running on Windows.
- Each file gets a HOST_BRANCH_EXCLUDED entry in tools/windows-tests.js carrying the same reason (the #1777 audit).

## Not a fix
None of these is a Windows bug: each subject does not exist on Windows. A failing Windows path would be a fix,
not a skip (helper doc).

## Done when
- The four files run 0 failed on the Windows box; skipped counts 2, 1, 3 (+3 pre-existing), 1 (oldjob now 14 tests: 13 pass, 1 skipped).
- engine/windows-tests-1777, engine.reachable, win32-separator-guard, fixture-discipline, no-name-refs green.
- Mac/Linux CI green (the skips read false there; none of the four is in the Windows CI selection).
