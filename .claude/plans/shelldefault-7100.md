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
- tools/lib/shell-parallel.sh: `kosmos_shell_parallel_default` prints 4, or 1 when any of these holds:
  `GITHUB_ACTIONS=true`; `CI` set to anything but false or 0, in any case; `KOSMOS_SHELL_SHARD`;
  `KOSMOS_SHELL_PLATFORM`; `KOSMOS_SHELL_CUT_ENV=1`.
- tools/run-tests.sh: loads the library where the switch is read (it only defines functions; the late load in the
  parallel branch is removed). An unset or empty switch takes the default; a set one is kept and validated as before.
- tools/release.sh: right after its #5934 guard, `export KOSMOS_SHELL_PARALLEL=1`, so a cut's gate runs stay one at
  a time. The guard still sees the caller's own value first.
- CLAUDE.md and run-tests.sh's header describe the new default.
- tools/test-shell-parallel-7100.sh: arm 8 (the default in fourteen environments, each scrubbed first, CI spellings included); arm 9 (end to
  end: the real run-tests.sh with a stub node that records each shell-shard.js call; unset starts run 1..4 of 4,
  GITHUB_ACTIONS=true runs 1 of 1, KOSMOS_SHELL_PARALLEL=2 is kept, empty is 1); arm 10 (a tripwire, since a test
  cannot run a cut: release.sh's export is the first code after its guard's fi, and no later code touches the
  switch). 21 arms. (Review 1 replaced an exact-line tripwire on run-tests.sh with
  arm 9: the tripwire would red on an equivalent rewrite and stay green if the value were overwritten later.)

- tools/lib/shell-parallel.sh: each shard now runs under a small perl supervisor (`_KOSMOS_SHARD_SUPERVISOR`) in
  place of a plain `setpgrp; exec`. It leads the shard's group, forks the command beneath it, exits with its status,
  and polls its own parent every 0.5 s. When the runner is gone (even by a KILL, which runs no trap), it TERMs its
  group, waits up to 2 s, and KILLs it. Why: at 10:31 CDT on 2026-10-25 a validation of this branch on Mortals was
  stopped by stop-mortals-validate.sh for the 0.7.67 cut. That script stops the run's leader group, TERM then KILL,
  so shards 2 to 4, each in a group of its own, ran on beside the cut until stopped by hand. With the default at 4,
  every tool that stops a run by its group would have hit this. Arm 4f: a KILL to the runner, and both shards'
  running tests are gone within 8 s. The old launcher and a supervisor that never checks its parent each red 4f.

## Decided
- In the repo, not in the shared validation library: that library serves every org repo, and this is a Kosmos-only
  setting.
- A cut stays serial. The release gate is Baron's lane, and running a cut's suite in parallel is that gate's call.
- Only an UNSET switch takes the default. Set but empty stays 1, as it was before (review 2: a wrapper exporting an
  empty value to mean "off" would otherwise silently get 4 shards). release.sh's guard refuses an empty value anyway.
- The library loads unconditionally and a missing one exits 1, like tools/lib/test-locale.sh a little further down,
  which already fails every run (`--only` included) when it is absent. So a fixture that copies run-tests.sh without
  its libraries was already broken, and a fallback here would make no such fixture work. The only copies in the
  suite (tools/test-cut-guard.sh, three) copy `lib/*.sh` (review 2, deferred with this reasoning).
- Four, not more: measured, and the queue allows two suites per machine, so eight shard processes at most.

## Weakest premises
- Several tests start run-tests.sh themselves, in fixture trees with a scrubbed environment. Those nested runs now
  take the default too, 4 unless they set CI-style variables. No unset protects against that, because a default is
  computed, not inherited. Review 3 searched the tree: the only nested run that reaches the shell part with the
  default is arm 9 itself (a stub node). The others use --only (test-runner-scale-export-5727), stop at a refusal,
  only read the source, or run a fixture with --sleep (test-cut-guard). That is a search, not a run. MEASURED since:
  the full suite on this branch (83a3c146) on Mortals with the switch unset, so the default applied everywhere,
  nested runs included: rc 0, node 23,934 tests and 0 failed, shell part as 4 shards at once in 738 s, all green, the
  whole suite in 1,326 s (experiment e, ended 10:10 CDT 2026-10-25). Later commits on this branch changed tests,
  comments and the CI check, not what an unset local run does.
- Arm 9 runs the real run-tests.sh to its end, so it also passes through the gates there (browser-check trailers on
  this repo's branch diff, the LaunchAgents guard). It is judged on the shard calls alone, not the exit status (review
  3), so a red elsewhere at the end does not read as a broken default.
- Load: four shards beside another suite on a shared machine. Measured once on Agent1s (the 603 s run shared the
  machine) and on an idle Mortals. Not measured on a machine with less memory.
- The CI check is `GITHUB_ACTIONS=true`, or `CI=true` or `1` (review 4 added CI, which most CI systems set). A runner
  that sets neither would default to 4. The repo's CI shard jobs also set KOSMOS_SHELL_SHARD, which covers them
  independently. CI is unset in this machine's agents and suites (checked 2026-10-25), so local runs still get 4.

## Validation
- tools/test-shell-parallel-7100.sh: 21 arms pass plainly and under a CI shard's environment
  (`KOSMOS_SHELL_SHARD=1/2 KOSMOS_SHELL_CUT_ENV=1 GITHUB_ACTIONS=true KOSMOS_SHELL_PLATFORM=linux`).
- Mutants, each red on its own arm: always 4 (arms 8 and 9); ignoring GITHUB_ACTIONS (arm 8); the old `:-1`
  default in run-tests.sh (arm 9); empty taking the default (arm 9); release.sh without the export, the export
  before the guard, the export inside a dead branch, and a later unset (arm 10); the old plain launcher, and a
  supervisor that never checks its parent (arm 4f).
- test-cut-testpart-guard-5934, test-cut-shape-6977, test-sleep-control-guard-6710, test-mktemp-template-4298 and
  test-gnu-only-forms-6808 all pass.
