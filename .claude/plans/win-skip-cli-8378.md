# win-skip-cli-8378: the bash-CLI cluster of #8378 (kosmos#8378)

**Posture:** production

## Problem
#8378, fifth cluster. On a Windows host, tests that run `install/kosmos` (the Mac and Linux CLI, a bash script)
directly by its shebang line fail with "the CLI gave no exit code (ENOENT)": Windows cannot run a script by its shebang.
On Windows the product CLI is a different program (tools/windows/kosmos-cli.js).

## How the set was chosen
Fresh inventory of origin/main 5fb3931c4d on the Windows box (2120 files, 481 failing), then every failing test's first
error line: the 58 files whose every failing test fails on that spawn (480 tests). Re-run on origin/main 7e22417da2
in this worktree.

## Change (test-only; no production code)
- Each file: one `SKIP_POSIX_SHELL = skipOnWin32(<the established shebang reason>)`, false off Windows, so macOS and
  Linux run every test and assertion as before. cli.busy-health-4466 and cli.community-comment-4373 also run it through
  /bin/bash (they source install/kosmos): `SKIP_POSIX_BASH` with the established absolute-path reason.
  cli.livecheck-prefix-8156 runs bash on a PATH of absolute POSIX folders: its own reason, naming that.
- A test that drives only the Mac CLI is skipped on Windows with the reason.
- A test that drives BOTH CLIs (63 tests in 15 files) keeps running on Windows with only its Mac-CLI steps left out:
  where a `BOTH` list loops over the two CLIs, `CLIS = BOTH.filter(... not Mac when SKIP_POSIX_SHELL)`; elsewhere the
  Mac calls and the assertions that read them are guarded `if (!SKIP_POSIX_SHELL)`; a Mac-to-Windows text comparison
  is guarded (there is no Mac text on Windows). Every Windows-CLI step and assertion still runs on Windows. Two tests
  stay skipped whole: "#5874 Mac: task activity ..." and "#8202 Mac: task show ...", Mac tests whose Windows call only
  produces comparison text with no assertion of its own (each file's own Windows test covers that arm).
- tools/windows-tests.js: 58 HOST_BRANCH_EXCLUDED entries carrying each file's reason(s).

## Not a fix
The Mac CLI is not run on Windows by any user; Windows runs tools/windows/kosmos-cli.js. Running install/kosmos
through Git Bash in tests was considered and rejected: it would test a program Windows users never run, through a
shell layer the product does not use.

## Done when
- The 58 changed files run 0 failed on the Windows box; the mixed tests' Windows halves run (61 more tests passing than
  a whole-test skip would give).
- windows-tests-1777, windows-coupling-audit-1732, engine.reachable, win32-separator-guard, fixture-discipline,
  no-name-refs green.
- Mac/Linux CI green (the guards are false there; none of the files is in the Windows CI selection).
