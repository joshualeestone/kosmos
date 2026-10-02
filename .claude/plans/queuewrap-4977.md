# queuewrap-4977: the queue wrapper in the repo, pinned by a CI test (item 3 of #4977)

Card: kosmos#4977 (follow-up to #4911; moved from PigeonPete to Angel by Splinter, 2026-10-02 00:10).

## Stacked on #4911
This branch starts from origin/queueside-4911 (ebd450ba9): the wrapper calls 7 functions that exist only in #4911's `tools/lib/cut-guard.sh` (kosmos_light_side_clear, _take, _intruder, kosmos_release_light_side, kosmos_holds_light_side, kosmos_publish_light_side_pgid, kosmos_refuse_if_light_side_live). It is rebased onto main once #4911 merges, and its PR opens then. Item 1 (aging while 5-line markers are live) is built after #4911 merges, on main: it changes `_kosmos_suite_waiters_ahead`, which #4911 still changes each round.

## Done looks like (item 3)
The wrapper every fleet Mac's heavy one-off runs through is a file in the repo, and CI runs a test that pins its behaviour; the test can never put a copy in the real queue.

## Change
- `tools/queued-heavy.sh`: PigeonPete's reviewed #4911 wrapper (`~/.cache/claude-handoffs/queued-heavy.sh.4911-new`, round 20), with these edits:
  - the guards' checkout defaults to `$HOME/work/kosmos-bc-main-4610` (was a path under one user's home), still overridable by `QUEUED_HEAVY_LIB`;
  - its header says the repo file is the source and `~/.cache/claude-handoffs/queued-heavy.sh` is the installed copy;
  - behaviour fixes found by this test's reviews (rounds 2-4): the side turn's two temp files are named under `${TMPDIR:-/tmp}` (macOS `mktemp -t` ignores TMPDIR; a stale TMPDIR falls back to /tmp); a killed wrapper's capper removes them; a killed but unreaped (zombie) wrapper counts as killed, so its command is stopped rather than run on unclaimed to the cap; `_qh_end` removes the stop file after the capper is gone.
- `tools/test-queued-heavy-4977.sh`: Pete's dry harness (74 arms: side turns, yields, TERM and SIGKILL handling, nested turns, claim labels, which commands take an ordinary turn), run against this tree's own lib, plus:
  - every run of the wrapper goes through a shim that refuses (exit 99) unless KOSMOS_RUN_MARKER_DIR is inside the test's own mktemp dir; a control arm proves the shim refuses;
  - fake package managers first on PATH (as the harness had);
  - stray processes are stopped only by an exact `^sleep <N>$` match on lengths unique to this run (no broad pkill), and an EXIT trap cleans up;
  - it counts: 0 BAD and exactly 76 OK, else it fails (74 seeded arms, the shim control, the killed wrapper's temp files).
- `package.json`: `test:shell` runs it (tools.every-test-runs.test.js would otherwise flag it as orphaned).

## Review rounds
- 1: a 15-min fuse (the fake holder was `sleep 900`), yield arms racing the start gate, fixed sleeps, no per-run deadline, the env not cleaned, unanchored reads, background wrappers not stopped. Fixed (one browser flag per arm, raised once the arm's command runs; polls; a perl alarm in the shim, QH_DEADLINE 240 s).
- 2: the SIGPIPE arm never ran its command (fixed: the reader leaves after the side turn starts, and the arm requires the command ran); the wrapper's temp files outside the test dir (fixed in the wrapper: named under `${TMPDIR:-/tmp}`, since macOS `mktemp -t` ignores TMPDIR; and a killed wrapper's capper removes them); stale pids and TERM-proof sleeps in the trap; per-pid-unique sleep lengths.
- 3: the trap could match another agent's wrapper (now by parentage and this tree's path); the capper's cleanup only on the stop path (now on every exit, only on ESRCH); a stale TMPDIR falls back to /tmp; an arm pins the cleanup; the b arm's race (wait for the side turn to leave the queue).
- 4: a killed but unreaped wrapper (a zombie: macOS `kill -0` succeeds on it) was not seen as killed, so its command ran on unclaimed to the cap; `_qh_wrapper_gone` now counts ps state Z (probed: zombie gone, live live, reaped gone). Also: `_qh_end` removes the stop file after the capper is gone; the b arm checks its wait and uses a unique sleep; the trap waits for what it stopped. Not testable in the suite: holding a zombie open (bash reaps promptly), so it was probed by hand.
- 5: the main-turn renewer had the same zombie gap (it could renew the machine claim for hours): now `_qh_wrapper_gone` too; `LC_ALL=C` on its kill (as the lib's `_kosmos_pid_gone`); the b arm fails fast. **Left for item 1 (after #4911 merges):** the lib's own liveness check (`cut-guard.sh`, `kill -0`) still reads a zombie wrapper's claim as live until it is reaped (bounded by the claim's expiry); the wrapper's comment says so.

## Decisions
- The repo copy keeps reading the guards from ONE main checkout, not the worktree it runs from: every worktree reading its own branch's lib is how several lib generations end up in one queue (item 1's cause).
- Not done here: installing the repo copy over ~/.cache (rollout stays Pete's #4911 step: mv over the live one). Because the repo copy carries the behaviour fixes above, the rollout should install THIS file (or the live copy gets them later by the same mv); told Pete.
- Weakest premise: that the single main checkout stays updated; if not, every waiter reads the same stale lib (as today).

## Validation
- `bash tools/test-queued-heavy-4977.sh`: 76 OK, 0 BAD, three runs in a row after review 4 (about 80 s each), no sleeps or temp files left behind.
- Mutant: removing the wrapper's scan for suite-like commands turns it red (light runs of browser-checks.sh and `yarn test` forms got side turns).
- no-name-refs-3071, no-brand-refs-1881, fixture-discipline, tools.heavy-gate-3805, tools.shell-shard-4317, tools.every-test-runs: pass.
