# win-guard-tests-8378: the token-only guard's test files on Windows (kosmos#8378, triage step 3)

**Posture:** production

## Problem
Seven guard test files fail on Windows (185 tests): hookscripts-5774, startupfiles-5774, startplugins-5774,
launchpath-5516, configstart-5516, launchprune-5663, boardkeychain-4491. Two causes:
- Most test the macOS/Linux guard (a darwin or linux platform seam, the Seatbelt sandbox, POSIX shell startup files,
  the PATH scan that Windows does not build yet, /bin/bash), whose subject does not exist on Windows.
- A home leak: on Windows os.tmpdir() is inside the user's home, so a test sandbox has the real home as an ancestor, and
  the guard's ancestor walk (setup-assistant.js tokenOnlySettingsRules) reads the real ~/.claude/CLAUDE.md and its
  imports. Results depended on the computer running them (23 tests).

## Change (test-only; no production code)
- New test-support/tmpscope-outside-home.js, required in place of tmpscope by the seven files: on a Windows host whose
  temp folder is inside the home, TEMP and TMP point at %SystemRoot%\Temp before tmpscope runs, used only if a folder can
  be made there and no instruction file (CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude) sits in it or any folder above
  it; otherwise nothing changes. tmpscope's per-process folder and its sweep work as before. Off Windows it is tmpscope.
  Test: test-support.tmpscope-outside-home.win32-8378.test.js.
- Proof the real home is no longer read: a read-logging preload counted 3,432 reads under the real ~\.claude for
  configstart-5516 at HEAD (negative control) and zero with the helper, with every guard test running.
- Skips on Windows, each with a reason naming the mechanism (the macOS/Linux guard, POSIX shell startup files, the PATH
  scan Windows does not build yet, /bin/bash, the Mac/Linux supervisor snippet). 12 hookscripts parser tests are skipped
  as POSIX absolute paths: making them platform-neutral was tried and abandoned, because on Windows the splitter's output
  is inconsistent (filed as #8451 with two more findings, all live on Windows).
- tools/windows-tests.js: the seven files join ALSO, so the Windows CI job runs them (their remaining Windows arms pass,
  none is all-skip).

## Measured on the Windows box (pass/fail/skip, before -> after)
hookscripts 5/36/0 -> 7/0/34; startupfiles 1/33/0 -> 2/0/32; startplugins 3/19/0 -> 3/0/19; launchpath 3/32/0 -> 4/0/31;
configstart 4/16/0 -> 8/0/12; launchprune 5/18/0 -> 7/0/16; boardkeychain 15/31/0 -> 28/0/18 (including the real
Windows-arm test "#5664 step A", which now passes whole); tokenguard.win32-5664 26/0/0 unchanged.

## Review rounds
- Round 1: BLOCKER on GitHub's runner (TEMP spelled 8.3, `C:\Users\RUNNER~1`, home long): the helper compared plain
  strings, so it did nothing there and its own test failed. Now it compares real paths (case-blind), with a pure test
  of the runner shape; the host test follows what the helper decides; a refused move prints one stderr line with why.
  The seven files moved from HOST_BRANCH_EXCLUDED to ALSO. The shared system-temp residual is documented in the header.
- Round 2: BLOCKER, the same 8.3 case for a folder not made yet (the system Temp under a short-spelled scope): realOrResolved
  now resolves the deepest existing folder and adds the rest back (as the guard's realOrLeaf does); test against
  C:/PROGRA~1/no-such (fails on the previous helper). The hookscripts parser-skip reason names kosmos#8451.

- Round 3: WARNING, the helper compared real paths only, but the guard walks both the written and the real chain: the
  temp folder now counts as inside the home if either spelling is, and both chains of the system folder are checked for
  instruction files (test with a junction-shaped seam, fails on the previous helper). Two test NITs: a control that could
  not fail now uses a non-instruction file where the helper looks; an early return on a host with temp outside the home
  is an honest skip.

## Decided, not missed
- The home-leak fix moves these files' fixtures to the machine-wide %SystemRoot%\Temp on Windows (test-only). Rejected: a
  production seam to stop the guard's ancestor walk at the sandbox (a production change for a test need). Weakest point:
  fixtures land in a shared system folder (standard users there can create but not list others' files; a killed run
  leaves its kts- folder there). Would change my mind: a reviewer showing a runner where that folder is not writable or
  is unsafe; the helper then falls back to plain tmpscope.

## Done when
- The seven files 0 failed on the box; tokenguard.win32-5664 unchanged; policy tests green; Mac/Linux CI green.
