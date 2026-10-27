# win-toolguard-7318

**Posture:** production

Addresses #7318: test-support/tool-guard.js (#4326) never refused a real gh.exe on Windows, though tools/run-tests.sh
preloads it there. Its verdict on each word was POSIX-shaped. Stacked on #7316 (#7262), which this edits after.

## Done when (from the card)
1. On Windows, a word with \ or a drive letter is a path.
2. A name matches with any PATHEXT extension, case-insensitively (gh.exe, vercel.cmd).
3. A bare name resolves through PATH plus PATHEXT (and the current directory first, as Windows does).
4. The allowed roots (repo, temp dir) compare case-insensitively.
5. The win32 skip in tools.command-words-7262.test.js is removed and its tool-guard arms pass on the Windows box.

## Changes
- tool-guard.js: WIN-only helpers envVar (case-insensitive env names; a process.env copy keeps "Path"), pathExts,
  toolName, isPathWord, within; onPath's Windows branch; realpathSync.native on Windows so an 8.3 temp dir (RUNNER~1)
  still contains its own fakes. POSIX behaviour unchanged (toolName exact, '/' paths, execute bit).
- tools.command-words-7262.test.js: the stand-in is gh.cmd on Windows; the win32 skip and TOOL_GUARD_HOST removed; a
  #7318 test with Windows arms (paths, case, PATHEXT, Path, cmd /c) and a POSIX control (gh.exe is not gh there).

## Verification
- tools.command-words-7262.test.js + engine/windows-tests-1777.test.js + tools.windows-tests-schtasks-7247.test.js
  under the schtasks preload on the Windows box: 58/58, 0 skipped.
- Negative control: against the unpatched tool-guard.js, 3 tests fail (both #7262 tool-guard tests and the #7318 one).
- All 87 engine/*win32*.test.js with BOTH preloads (schtasks + tool-guard, as npm test would), new vs old guard:
  identical, 1588 tests, 0 fail, 0 refusals. This box has a real gh.exe on PATH.
- test-support.tool-guard-4326.test.js fails 12 tests on Windows before and after (POSIX-only fixtures: /bin/sh, /usr/bin,
  extensionless stubs); not selected for Windows CI; out of scope.

## Weakest part
Each lookup (node, cmd, Git Bash) is judged by its own first find; refusing when ANY is real over-refuses a cmd call
whose fake .cmd comes first while a real .exe sits later (node and bash would run the .exe). Refusing is
the safe side for a guard against real CLIs.

## Review rounds
- Round 1: 1 BLOCKER, 2 WARNINGs, 3 NITs. BLOCKER FIXED: an env holding both PATH and Path was read by insertion order;
  node sorts the keys and the child gets the first (PATH), so the standard fake-first setup on a Path-spelled box was
  refused and the reverse let a real gh through (reviewer measured both); envVar now sorts the same way. WARNINGs FIXED:
  an env with no PATH searches the parent's PATH, as node does; .exe and .com by path count whatever PATHEXT says, and
  PATHEXT entries are trimmed. NIT FIXED: within() with a drive-root allowed dir. NITs ACCEPTED: a not-yet-existing file
  under a mixed 8.3/long temp path is refused (conservative); a Git Bash /c/... path resolves to C:\c\... (pre-existing).
  Reviewer confirmed POSIX unchanged and the real gh.exe on this box refused in every ordinary shape. Negative control:
  the new test fails against round 0. 59/59.
- Round 2: 1 BLOCKER, 3 WARNINGs, 1 NIT. BLOCKER FIXED: PATH lookup tried every PATHEXT extension per directory, but
  node without a shell tries only .com/.exe (measured: node ran the real git past a fake git.cmd first on PATH), so a
  fake gh.cmd ahead of the real gh.exe hid it. onPath now returns the first find of each lookup (node: .com/.exe and cwd
  unless this process has NoDefaultCurrentDirectoryInExePath; cmd: the child env's PATHEXT and its copy of that
  variable; Git Bash: name then .exe, PATH only) and any real one refuses. The "Weakest part" claim that every-PATHEXT
  was a safe superset was wrong. WARNINGs FIXED: the NoDefaultCurrentDirectoryInExePath cwd skip (above); a URL cwd no
  longer throws; cmd's %VAR% is expanded on Windows. NIT noted: test-support.tool-guard-4326.test.js still fails 12 on
  Windows at base (POSIX fixtures); not this card. Negative control: the new test fails against round 1. 60/60; 87 win32
  files with both preloads: 1588 tests, 0 fail, 0 refusals.
