# win-skip-cli2-8378: the second bash-CLI cluster of #8378 (kosmos#8378)

**Posture:** production

## Problem
#8378, sixth cluster. The same mechanism as the fifth (PR #8445): tests that spawn `install/kosmos` (the Mac and Linux
CLI, a bash script) directly, which Windows cannot run by its shebang line. These 14 files report it as
`spawn <path>\install\kosmos ENOENT` rather than "the CLI gave no exit code", so the fifth cluster's selection missed
them. Six of them also hung on Windows after the spawn error (the process never exited).

## How the set was chosen
From the per-test reasons of origin/main 5fb3931c4d on the Windows box: the 14 files whose every failing test fails on
that spawn (191 tests). Re-run on origin/main 4c6f97acd7 in this worktree.

## Change (test-only; no production code)
- One `SKIP_POSIX_SHELL` per file with the established shebang reason (false off Windows).
- Mac-only tests skip on Windows (154, counted from the runs on the box). Tests that drive BOTH CLIs keep running on
  Windows with only their Mac steps and the assertions reading the stub's `seen` list (filled only by the Mac CLI)
  guarded (33 tests). The other 4 of the 191 now pass with no guard of their own (not separately explained). Every Windows-CLI step
  and assertion still runs there.
- tools/windows-tests.js: 14 HOST_BRANCH_EXCLUDED entries, placed after the create.tmux-linux-4917 entry (the fifth
  cluster's open PR adds its entries elsewhere in the object, so the two do not conflict).

## Done when
- The 14 files run 0 failed (and exit) on the Windows box.
- Policy tests green (windows-tests-1777, coupling audit, engine.reachable, separator guard, fixture-discipline,
  no-name-refs).
- Mac/Linux CI green (guards false there; none of the files is in the Windows CI selection).
