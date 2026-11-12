# win-runners-8378: the runner resolution and install tests on Windows (kosmos#8378)

**Posture:** production

Built on win-fixtures-8378 (PR #8460) for test-support/runnerstub.js; rebased on main once that merges.

## Problem
engine/runners.test.js fails 16 of 33 tests on Windows. Every cause is in the test; engine/runners.js takes its Windows
branches correctly:
- Tarballs were built with /usr/bin/tar, which Windows does not have (6 install tests).
- Stand-in binaries were extensionless shebang files made runnable by chmod. On Windows a file runs by its extension
  (runners.js hasExecutableExt, runnableExactly), so they correctly read absent.
- The managed paths were written as runners/<provider>/<bin>. On Windows managedBin names the package layout
  (codex.exe, gemini.cmd, grok.exe under pkg).
- The Windows managed rungs count a binary only with its verified marker, so a hand-placed codex.exe reads absent.
- Because of that, on main the "already present" install test started a REAL codex download from registry.npmjs.org on
  a Windows host (into the sandbox). A test must never reach the network; after this change it does not.

## Change (test-only; no production code)
- Windows stand-ins carry the extension Windows runs (.exe, .cmd); managed paths come from runners.managedBin, and a
  managed copy gets its verified marker in install()'s own stamp format.
- The install tests build their tarball with runners.tarBin('win32') (System32 tar.exe) and the Windows package layout
  on Windows, and run the real Windows install path against the local fixture server.
- "present means RUNNABLE" (#133) and the codex not-executable test get Windows arms: a file with no runnable
  extension reads absent, and a .exe beside it reads present.
- Two skips: a folder made unwritable with chmod 0o500 (Windows keeps only a read-only attribute, which does not stop
  writes to a folder); and the antigravity vendor path, which Windows never reads (agystatus.win32-3568 covers Windows).
- tools/windows-tests.js: the file joins ALSO.
On macOS and Linux every value and assertion is as before.

## Decided, not missed
- engine/runners.gemini-grok-3713.test.js fails 11 of 12 on Windows for the same /usr/bin/tar reason. Left for its own
  change, to keep this one reviewable.
- The weakest part: the test writes the verified marker in the stamp format production uses; if production changes
  that format, these tests go red (loudly), not green.

## Measured on the Windows box
Before 17 pass / 16 fail; after 31 / 0 / 2 skip. The other runners files are unchanged (linux-5419 7/7, pathext-win32-570
6/6, win-runnable-2270 2/2, win32-codex 15/15, win32-gemini-grok 11/11). Policy tests pass.

## Review log
- Round 1 (no blockers, 2 warnings, 3 nits). Fixed: the "already-present answer" test (the one that reached npm on main)
  now passes a download that throws, so a future regression fails the test instead of fetching from the network; the #133
  directory arm makes its folder at claude.exe on Windows, so it tests the folder refusal and not just the missing
  extension. Nits fixed: the tarball comment names runners.tarBin, two assertion messages say "the tree" on Windows, an
  apostrophe. Noted, not changed: the claude link tests (pinned to darwin) make symlinks, which a non-admin Windows
  laptop without Developer Mode refuses; GitHub's runner is admin.
- Round 2 (no blockers, 1 warning, 2 nits). Fixed: the mid-prove join's second install passes a download that throws
  (on Windows the tree reads absent mid-prove, so a broken join would have fetched from npm); the Windows prove-failure
  arm also checks the verified marker is absent and the runner reads absent (the marker, not the tree's removal, is the
  real guard there); cleanup uses test-support/remove-tree.js, which retries while Windows holds a fresh .exe.
