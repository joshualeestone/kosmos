# queuewrap-4977: the queue wrapper in the repo, pinned by a CI test (item 3 of #4977)

Card: kosmos#4977 (follow-up to #4911; moved from PigeonPete to Angel by Splinter, 2026-10-02 00:10).

## Stacked on #4911
This branch starts from origin/queueside-4911 (ebd450ba9): the wrapper calls 7 functions that exist only in #4911's `tools/lib/cut-guard.sh` (kosmos_light_side_clear, _take, _intruder, kosmos_release_light_side, kosmos_holds_light_side, kosmos_publish_light_side_pgid, kosmos_refuse_if_light_side_live). It is rebased onto main once #4911 merges, and its PR opens then. Item 1 (aging while 5-line markers are live) is built after #4911 merges, on main: it changes `_kosmos_suite_waiters_ahead`, which #4911 still changes each round.

## Done looks like (item 3)
The wrapper every fleet Mac's heavy one-off runs through is a file in the repo, and CI runs a test that pins its behaviour; the test can never put a copy in the real queue.

## Change
- `tools/queued-heavy.sh`: PigeonPete's reviewed #4911 wrapper (`~/.cache/claude-handoffs/queued-heavy.sh.4911-new`, round 20), with two edits:
  - the guards' checkout defaults to `$HOME/work/kosmos-bc-main-4610` (was a path under one user's home), still overridable by `QUEUED_HEAVY_LIB`;
  - its header says the repo file is the source and `~/.cache/claude-handoffs/queued-heavy.sh` is the installed copy.
- `tools/test-queued-heavy-4977.sh`: Pete's dry harness (74 arms: side turns, yields, TERM and SIGKILL handling, nested turns, claim labels, which commands take an ordinary turn), run against this tree's own lib, plus:
  - every run of the wrapper goes through a shim that refuses (exit 99) unless KOSMOS_RUN_MARKER_DIR is inside the test's own mktemp dir; a control arm proves the shim refuses;
  - fake package managers first on PATH (as the harness had);
  - stray processes are stopped only by an exact `^sleep <N>$` match on lengths unique to this run (no broad pkill), and an EXIT trap cleans up;
  - it counts: 0 BAD and exactly 75 OK, else it fails.
- `package.json`: `test:shell` runs it (tools.every-test-runs.test.js would otherwise flag it as orphaned).

## Decisions
- The repo copy keeps reading the guards from ONE main checkout, not the worktree it runs from: every worktree reading its own branch's lib is how several lib generations end up in one queue (item 1's cause).
- Not done here: installing the repo copy over ~/.cache (rollout stays Pete's #4911 step: mv over the live one). After #4911's rollout the two are the same bytes but for the two edits above.
- Weakest premise: that the single main checkout stays updated; if not, every waiter reads the same stale lib (as today).

## Validation
- `bash tools/test-queued-heavy-4977.sh`: 75 OK, 0 BAD.
- Mutant: removing the wrapper's scan for suite-like commands turns it red (light runs of browser-checks.sh and `yarn test` forms got side turns).
- no-name-refs-3071, no-brand-refs-1881, fixture-discipline, tools.heavy-gate-3805, tools.shell-shard-4317, tools.every-test-runs: pass.
