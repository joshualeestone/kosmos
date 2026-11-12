# win-skip-posix-8378: the POSIX-modes and Mac-only cluster of #8378 (kosmos#8378)

**Posture:** production

## Problem
#8378 (phase 2 of #8368), third cluster. The first (PR #8408) added `skipOnWin32` and took the tests that run an
absolute POSIX path or a script by its shebang; the second (PR #8411) took tmux. This one takes four files the
tmux cluster left behind because their failures are not tmux: Linux-only lookup, launchd, /usr/bin/tar, and the
POSIX executable bit.

## How the set was chosen
Re-measured on origin/main 2b3c0c397d on the Windows box (node 24.19.0, TAP), every failing test's error read:
- `engine/create.tmux-linux-4917` tests 1-2: `linuxTmuxBin('linux', ...)` returns null. It asks
  `runners.isRunnable`, which on a Windows host judges by PATHEXT, so the extensionless fake `tmux` never counts.
  The function only does work when platform is linux; on Windows the code is never reached.
- `engine/connect-oldjob-8294` test 11: `foreignStarter` returns null at the "$HOME/agents/homey" arm. The folder
  spelling is built from a Windows path with backslashes and the fixture script spells it with POSIX slashes;
  launchd login jobs exist only on the Mac.
- `tools.sbom-o05` tests 47, 54, 55: `readTmuxBundle` runs `/usr/bin/tar` by absolute path (Windows cannot), and
  test 47's fixture file name holds a newline, which a Windows file name cannot. The SBOM is built only for the
  Mac release.
- `bundle.manifest` test 4: `mode & 0o111` on tools/verify-manifest.sh; Windows keeps no executable bit.

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
- The four files run 0 failed on the Windows box; skipped counts 2, 1, 3 (+3 pre-existing), 1.
- engine/windows-tests-1777, engine.reachable, win32-separator-guard, fixture-discipline, no-name-refs green.
- Mac/Linux CI green (the skips read false there; none of the four is in the Windows CI selection).
