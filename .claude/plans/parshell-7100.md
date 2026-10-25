# parshell-7100: run test:shell's shards at once locally, behind a switch (kosmos#7100)

## Why
#7086 measured the shell part at 26 to 43 minutes of 286 commands run one at a time, against 8 to 19 for the
parallel node part. CI already splits the list into shards on separate runners (#4317, tools/shell-shard.js).

## Change (this branch builds the switch; it does not turn it on)
- tools/run-tests.sh: `KOSMOS_SHELL_PARALLEL=<n>`. Unset or 1 is today's run (shard 1 of 1). 2 to 8 runs all of
  test:shell as n shards at once; anything else refuses (exit 2), and so does combining it with KOSMOS_SHELL_SHARD or
  with KOSMOS_SHELL_CUT_ENV=1 (one stand-in cut for one shell part, and its wrapper is a shell function a shard
  started through exec cannot run; review 2).
- tools/lib/shell-parallel.sh, `kosmos_shell_parallel <n> <log dir> <command...>`: starts `<command> i n` for each
  shard, each to its own log, waits for all, prints the logs in shard order and one summary line (time taken, which
  shards were red). Returns the first red shard's status, so the part reds when any shard does.
- The logs go in a folder beside the run root (`kt-shellpar.*`), not inside it: the leak guard compares temp
  families inside the root and would read the logs as a new one.
- Each shard starts as the leader of its own process group (a perl setpgrp, then exec). Both of run-tests.sh's EXIT
  traps call `kosmos_shell_parallel_stop` first, which TERMs every running shard's whole group, the test it is
  running included, waits up to about 2 s for the groups to be gone (review 2), and the folder is removed. A shard leaves `KOSMOS_SHELL_PARALLEL_PIDS` as soon as it has been
  waited on, so the trap never signals a pid another process may have taken since (review 1).
- A line per shard says its status when it is waited on. Shards are waited on in shard order (bash 3.2 has no
  wait -n), so a shard that ended before a lower-numbered one is reported when that one ends, with the time it was
  seen ended (review 3).
- The value is copied to `_RT_SHELL_PARALLEL` and `KOSMOS_SHELL_PARALLEL` is unset once validated, so the tests a run
  starts never inherit it: several start run-tests.sh themselves with a scrubbed environment that predates the switch,
  and one (tools.shell-shard-4317.test.js) would have reddened on the inherited value (review 3).
- The stop also signals the group of a shard already waited on while that group still has a member (something its
  tests left running). A group id cannot be taken by another group while its own has a member (review 3).
- CLAUDE.md's Test section names the switch.
- tools/release.sh's #5934 guard refuses KOSMOS_SHELL_PARALLEL other than 1 before the bump (review 1, BLOCKER): a
  leftover value would have run a cut's step 3 in parallel, or stopped it after the bump. Arms in
  tools/test-cut-testpart-guard-5934.sh (4, 0 and empty refuse; 1 is allowed).
- The branch's last command is `(exit "$_rt_ps_rc")`, because the existing `NODE_STATUS=$?` below the fi reads it.
- tools/test-shell-parallel-7100.sh (in test:shell): a stub shard, a barrier only shards started together pass,
  reds, order, an interruption (a TERM to a top-level runner must take each shard's child with it), run-tests.sh's
  refusals (each run in its own process group, TERMed whole at 60 s), and a tripwire on run-tests.sh's source: the
  parallel branch ends on its verdict on both paths and `NODE_STATUS=$?` follows the fi.

## Decided
- A library function, not an inline block: the logic is testable with a stub, without a fixture repository.
- Shards stay sha256-assigned (shell-shard.js), not balanced by time: the union stays the whole list by
  construction (tools.shell-shard-4317.test.js), and balancing is a later step if the measured shards are uneven.
- The default stays 1 until a measured full run is faster with no new reds (Splinter, 2026-10-25 02:09).

## Weakest premises
- Collision freedom is not shown by this branch. The static sweep found about 60 candidate files (fixed ports 15,
  literal /tmp 16, kill by pattern 13, real HOME paths 16, the machine claim 7, launchd 1, tmux 1). A concurrent run on
  Mortals is the measurement (serial, then two runs of 4 shards, same tree), and it can miss a race.
- The Mortals experiment's two parallel runs exported KOSMOS_SHELL_PARALLEL=4 to every test (the unset above came
  after it, in review 3). A shell test that starts run-tests.sh with a scrubbed environment could red there for that
  reason, which is not a collision: such reds are read against this before they count.
- A trap that runs between a shard's fork and its perl setpgrp finds no group to signal, and that shard runs on.
- A TERM is asynchronous: a shard's test that takes longer than the stop's 2 s wait to exit may still be running
  when the trap's later steps (the launchd boot-out, removing the run root) run. A test that puts itself in another process group (setsid) is not reached.
- The Mortals experiment measures tree 48d671ee, before review 1's changes to the harness (process groups, the pid
  list, the per-shard line). Those change how shards are started and stopped, not what the tests do, so the
  collision measurement still applies; the timing does not include them.
- Under bash 3.2 a ( ) subshell whose parent has an EXIT trap runs no EXIT trap of its own on a TERM (measured), so
  the interruption arm uses a separate top-level runner, as run-tests.sh is.
- The summary line's time is whole seconds from `date +%s`.

## Validation
- tools/test-shell-parallel-7100.sh: 14 arms pass, plain and with a CI shard's environment (KOSMOS_SHELL_SHARD,
  KOSMOS_SHELL_PLATFORM, KOSMOS_SHELL_CUT_ENV=1, GITHUB_ACTIONS=true), which reddened the cut-env arm before review 3
  scrubbed it. Review 3's mutants, each red on its own arm: a stop that ignores waited-on shards (the leftover arm);
  run-tests.sh without the unset (the private-switch tripwire). Earlier: 12 arms (the parallel and cut-env refusal arm added in review 2; its
  mutant was reasoned, not run: without the refusal, the CI-only cut-env check refuses first with another message,
  which the arm's message check rejects). Mutants, each red on its own arm: a serial runner (barrier and
  green); the last red's status (reds); killing the shard's pid, not its group (interruption); a line after the
  verdict exit in run-tests.sh (tripwire).
- tools/test-cut-testpart-guard-5934.sh: all pass; release.sh without the new clause reds exactly the three refusal
  arms.
- The 22 node tests that read run-tests.sh, test:shell or shell-shard.js: 362 tests, 0 failed (`run-tests.sh --only`).
