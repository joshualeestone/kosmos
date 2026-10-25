# shelldefault-7100: a plain local run-tests.sh runs test:shell as 4 shards at once (kosmos#7100)

## Why
#7113 built `KOSMOS_SHELL_PARALLEL` and left it off. Measured with it at 4, on 2026-10-25:
- Agent1s, origin/main cb57914b44: shell part 603 s against 2,285 s one at a time; 290 of 290 green both ways.
- Mortals, origin/main fd0cb1b154, two passes: 682 s and 669 s, against 2,209 to 2,594 s serial in earlier runs;
  290 of 290 green each time.
- Across four 4-shard passes on Mortals (four trees) and one on Agent1s, no red appeared only in parallel.

I first set the default in the two local validation helpers (`~/.cache/claude-handoffs/validate.sh` and
`mortals-validate.sh`). The effect check showed it reached almost nobody: the morning's validations by other agents
source `~/.claude/scripts/lib/validation-log.sh` directly and ran serially (2,040 to 2,082 s). So the default belongs
where every local run reads it.

## Change
- tools/lib/shell-parallel.sh: `kosmos_shell_parallel_default` prints 4, or 1 when any of these is set:
  `GITHUB_ACTIONS=true`, `KOSMOS_SHELL_SHARD`, `KOSMOS_SHELL_PLATFORM`, `KOSMOS_SHELL_CUT_ENV=1`.
- tools/run-tests.sh: loads the library where the switch is read (it only defines functions; the late load in the
  parallel branch is removed). An unset or empty switch takes the default; a set one is kept and validated as before.
- tools/release.sh: right after its #5934 guard, `export KOSMOS_SHELL_PARALLEL=1`, so a cut's gate runs stay one at
  a time. The guard still sees the caller's own value first.
- CLAUDE.md and run-tests.sh's header describe the new default.
- tools/test-shell-parallel-7100.sh: arm 8 (the default in seven environments, each scrubbed first) and arm 9 (two
  source tripwires: the unset-only line in run-tests.sh, and the export after the guard in release.sh). 21 arms.

## Decided
- In the repo, not in the shared validation library: that library serves every org repo, and this is a Kosmos-only
  setting.
- A cut stays serial. The release gate is Baron's lane, and running a cut's suite in parallel is that gate's call.
- An empty value now means "unset" (the default, 4); before this change an empty value meant 1. release.sh's guard
  refuses an empty value anyway.
- Four, not more: measured, and the queue allows two suites per machine, so eight shard processes at most.

## Weakest premises
- Several tests start run-tests.sh themselves, in fixture trees with a scrubbed environment. Those nested runs now
  take the default too, 4 unless they set CI-style variables. No unset protects against that, because a default is
  computed, not inherited. The full suite on this branch is the measurement.
- Load: four shards beside another suite on a shared machine. Measured once on Agent1s (the 603 s run shared the
  machine) and on an idle Mortals. Not measured on a machine with less memory.
- The CI environment check relies on `GITHUB_ACTIONS=true`. A self-hosted runner that does not set it would default
  to 4. The repo's CI shard jobs also set KOSMOS_SHELL_SHARD, which covers them independently.

## Validation
- tools/test-shell-parallel-7100.sh: 21 arms pass plainly and under a CI shard's environment
  (`KOSMOS_SHELL_SHARD=1/2 KOSMOS_SHELL_CUT_ENV=1 GITHUB_ACTIONS=true KOSMOS_SHELL_PLATFORM=linux`).
- Mutants, each red on its own arm: always 4; ignoring GITHUB_ACTIONS; the old `:-1` default in run-tests.sh;
  release.sh without the export; the export before the guard.
- test-cut-testpart-guard-5934, test-cut-shape-6977, test-sleep-control-guard-6710, test-mktemp-template-4298 and
  test-gnu-only-forms-6808 all pass.
