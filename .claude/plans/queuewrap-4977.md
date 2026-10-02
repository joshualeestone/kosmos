# queuewrap-4977: the queue wrapper in the repo, pinned by a CI test (item 3 of #4977)

Card: kosmos#4977 (follow-up to #4911; moved from PigeonPete to Angel by Splinter, 2026-10-02 00:10).

## Base
Built on #4911's branch, because the wrapper calls 7 functions #4911 added to `tools/lib/cut-guard.sh`. #4911 merged as #5005 (2026-10-02), and this branch was rebased onto main with only this card's commits (one package.json conflict: this test added to main's current `test:shell` line). Item 1 (aging while 5-line markers are live) is built next, on main.

## Done looks like (item 3)
The reviewed source of the queue wrapper is a file in the repo, and CI runs a test that pins its behaviour; the test can never put a copy in the real queue. Installing it over the copy agents run (`~/.cache/claude-handoffs/queued-heavy.sh`) is a separate rollout step, and until it happens the live copy lacks this branch's behaviour fixes.

## Change
- `tools/queued-heavy.sh`: PigeonPete's reviewed #4911 wrapper (`~/.cache/claude-handoffs/queued-heavy.sh.4911-new`, round 20), with these edits:
  - the guards' checkout defaults to `$HOME/work/kosmos-bc-main-4610` (was a path under one user's home), still overridable by `QUEUED_HEAVY_LIB`;
  - its header says the repo file is the reviewed source, and that the live copy (`~/.cache/claude-handoffs/queued-heavy.sh`) is installed separately with nothing checking they match;
  - behaviour fixes found by this test's reviews (rounds 2-4): the side turn's two temp files are named under `${TMPDIR:-/tmp}` (macOS `mktemp -t` ignores TMPDIR; a stale TMPDIR falls back to /tmp); a killed wrapper's capper removes them; a killed but unreaped (zombie) wrapper counts as killed, so its command is stopped rather than run on unclaimed to the cap; `_qh_end` removes the stop file after the capper is gone.
- `tools/test-queued-heavy-4977.sh`: Pete's dry harness (74 arms: side turns, yields, TERM and SIGKILL handling, nested turns, claim labels, which commands take an ordinary turn), run against this tree's own lib, plus:
  - every run of the wrapper goes through a shim that refuses (exit 99) unless KOSMOS_RUN_MARKER_DIR is inside the test's own mktemp dir; a control arm proves the shim refuses;
  - fake package managers first on PATH (as the harness had);
  - stray processes are stopped only by an exact `^sleep <N>$` match on lengths unique to this run (no broad pkill); an EXIT trap stops the background wrappers it started (a wrapper run inside a command substitution ends by its own arm's wait and the shim's 240 s deadline);
  - it counts: 0 BAD and exactly 79 OK, else it fails (74 seeded arms, the shim control, the killed wrapper's temp files, and three lib arms: a missing checkout, a lib missing a main-lane function, and one with the side gate but no side release all exit 3).
- `package.json`: `test:shell` runs it (tools.every-test-runs.test.js would otherwise flag it as orphaned).

## Review rounds
- 1: a 15-min fuse (the fake holder was `sleep 900`), yield arms racing the start gate, fixed sleeps, no per-run deadline, the env not cleaned, unanchored reads, background wrappers not stopped. Fixed (one browser flag per arm, raised once the arm's command runs; polls; a perl alarm in the shim, QH_DEADLINE 240 s).
- 2: the SIGPIPE arm never ran its command (fixed: the reader leaves after the side turn starts, and the arm requires the command ran); the wrapper's temp files outside the test dir (fixed in the wrapper: named under `${TMPDIR:-/tmp}`, since macOS `mktemp -t` ignores TMPDIR; and a killed wrapper's capper removes them); stale pids and TERM-proof sleeps in the trap; per-pid-unique sleep lengths.
- 3: the trap could match another agent's wrapper (now by parentage and this tree's path); the capper's cleanup only on the stop path (now on every exit, only on ESRCH); a stale TMPDIR falls back to /tmp; an arm pins the cleanup; the b arm's race (wait for the side turn to leave the queue).
- 4: a killed but unreaped wrapper (a zombie: macOS `kill -0` succeeds on it) was not seen as killed, so its command ran on unclaimed to the cap; `_qh_wrapper_gone` now counts ps state Z (probed: zombie gone, live live, reaped gone). Also: `_qh_end` removes the stop file after the capper is gone; the b arm checks its wait and uses a unique sleep; the trap waits for what it stopped. Not testable in the suite: holding a zombie open (bash reaps promptly), so it was probed by hand.
- 5: the main-turn renewer had the same zombie gap (it could renew the machine claim for hours): now `_qh_wrapper_gone` too; `LC_ALL=C` on its kill (as the lib's `_kosmos_pid_gone`); the b arm fails fast. **Left for item 1 (after #4911 merges):** the lib's own liveness check (`cut-guard.sh`, `kill -0`) still reads a zombie wrapper's claim as live until it is reaped (bounded by the claim's expiry); the wrapper's comment says so.
- 6: NO NEW ISSUES (one nit taken: wait for the f arm's wrapper). Converged before the rebase.
- After the rebase (new loop, iteration 1): the temp-file cleanup arm could pass if the files were never made (the fixture arm now requires them in this test's TMPDIR); the header said the live copy is installed from this file (it is not; reworded); this plan's base and validation lines were stale.
- Iteration 2: the test now runs from an empty dir, so the relative real scripts its cases name (`bash tools/test-install.sh`) cannot run if a refusal lapsed. Left as found: `_qh_take`'s stale-lock takeover can let two waiters in when the lock's holder died holding it (both read the dead pid; the second's `rm -rf` removes the first's new lock). It is #4911's lock, already in the live copy; this branch pins the wrapper rather than redesigning it. Logged on #4977 as a follow-up.
- Iteration 3: the wrapper's comments said the guards are read from a checkout at origin/main; they are read from whatever checkout QUEUED_HEAVY_LIB names, and nothing updates it (reworded).
- Iteration 4: an arm for a lib checkout without cut-guard.sh (exit 3, nothing runs); `bash -n` of both scripts in `test:shell`; the plan's cleanup line says what the trap stops. Left as found: the test writes the machine-claim line in the lib's format by hand; if that format changes the hold arms go red, not green.
- Iteration 5: this validation section still read 76 after the 77th arm (updated); the header named a run-tests.sh line number, now the function.
- Iteration 6: the load check named only kosmos_wait_until_clear, so a stale lib missing another function the wrapper calls would have waited out the queue bound; it now checks each (exit 3), with an old-lib arm (78). This section's stale 76 lines merged.
- Iteration 7: the load check now also covers the side lane's unguarded functions (take, publish, release) whenever its gate exists, by `declare -F` (a PATH executable no longer satisfies it), with a half-lib arm (79); the test unsets QUEUED_HEAVY_CLAIM_MIN and KOSMOS_CLAIM_KEEP_LABEL too; the done-sentence says installing is a separate step.

## Decisions
- The repo copy keeps reading the guards from ONE main checkout, not the worktree it runs from: every worktree reading its own branch's lib is how several lib generations end up in one queue (item 1's cause).
- Not done here: installing the repo copy over ~/.cache (rollout stays Pete's #4911 step: mv over the live one). Because the repo copy carries the behaviour fixes above, the rollout should install THIS file (or the live copy gets them later by the same mv); told Pete.
- Weakest premise: that the single main checkout stays updated; if not, every waiter reads the same stale lib (as today).

## Validation
- Before the rebase: 76 OK, 0 BAD, three runs in a row after review 4 (about 80 s each), no sleeps or temp files left behind.
- At 90196c2bd (after the rebase and post-rebase reviews 1-7): 79 OK, 0 BAD. tools.shell-shard-4317, tools.every-test-runs, no-name-refs-3071, no-brand-refs-1881, fixture-discipline and tools.heavy-gate-3805 pass at e905768da, run from the worktree root (since then only the wrapper's load check and this test changed).
- Mutants, each turning exactly its arm red: removing the wrapper's scan for suite-like commands (light runs of browser-checks.sh and `yarn test` forms got side turns); the side turn's temp files made in /tmp instead of TMPDIR (the fixture arm); the load check back to kosmos_wait_until_clear alone (the old-lib arm); the side-lane names dropped from the load check (the half-lib arm).
