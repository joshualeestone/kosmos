# parshell-7100: run test:shell's shards at once locally, behind a switch (kosmos#7100)

## Why
#7086 measured the shell part at 26 to 43 minutes of 286 commands run one at a time, against 8 to 19 for the
parallel node part. CI already splits the list into shards on separate runners (#4317, tools/shell-shard.js).

## Change (this branch builds the switch; it does not turn it on)
- tools/run-tests.sh: `KOSMOS_SHELL_PARALLEL=<n>`. Unset or 1 is today's run (shard 1 of 1). 2 to 8 runs all of
  test:shell as n shards at once; anything else refuses (exit 2), and so does combining it with KOSMOS_SHELL_SHARD.
- tools/lib/shell-parallel.sh, `kosmos_shell_parallel <n> <log dir> <command...>`: starts `<command> i n` for each
  shard, each to its own log, waits for all, prints the logs in shard order and one summary line (time taken, which
  shards were red). Returns the first red shard's status, so the part reds when any shard does.
- The logs go in a folder beside the run root (`kt-shellpar.*`), not inside it: the leak guard compares temp
  families inside the root and would read the logs as a new one.
- Both of run-tests.sh's EXIT traps stop the shards (`KOSMOS_SHELL_PARALLEL_PIDS`) and remove the folder on an
  interruption. Today a TERM waits for the foreground shard to finish; now each shard's node is stopped and only the
  command already running finishes.
- The branch's last command is `(exit "$_rt_ps_rc")`, because the existing `NODE_STATUS=$?` below the fi reads it.
- tools/test-shell-parallel-7100.sh (in test:shell): a stub shard, a barrier only shards started together pass,
  reds, order, and run-tests.sh's refusals, each bounded by a perl alarm.

## Decided
- A library function, not an inline block: the logic is testable with a stub, without a fixture repository.
- Shards stay sha256-assigned (shell-shard.js), not balanced by time: the union stays the whole list by
  construction (tools.shell-shard-4317.test.js), and balancing is a later step if the measured shards are uneven.
- The default stays 1 until a measured full run is faster with no new reds (Splinter, 2026-10-25 02:09).

## Weakest premises
- Collision freedom is not shown by this branch. The static sweep found about 60 candidate files (fixed ports 15,
  literal /tmp 16, kill by pattern 13, real HOME paths 16, the machine claim 7, launchd 1, tmux 1). A concurrent run on
  Mortals is the measurement (serial, then two runs of 4 shards, same tree), and it can miss a race.
- On a TERM, the command each shard was running finishes after the shard's node is stopped (its sh child is not in
  the kill list).
- The summary line's time is whole seconds from `date +%s`.

## Validation
- tools/test-shell-parallel-7100.sh: 9 arms pass. Mutants: a serial runner reds the barrier and green arms; taking
  the last red's status reds the reds arm.
- The 22 node tests that read run-tests.sh, test:shell or shell-shard.js: 362 tests, 0 failed (`run-tests.sh --only`).
