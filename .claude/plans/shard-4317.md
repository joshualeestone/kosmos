# shard-4317: the test job runs as parallel jobs, none near its limit (#4317, the shard part)

## Finished means (Liu Kang, m2357)
- test.yml runs the suite as 2 or 3 parallel jobs, deterministically, and each job's wall time is
  under about 60% of its timeout on main, measured from real runs.
- Every test runs exactly once across the jobs, with a check that the shards' union is the full list.
- A job-summary warning when a job's wall time passes 70% of its timeout.
- No change to what any test asserts.

## Measured before building
- The last green main runs: the suite step took 1,438 s, 1,694 s and 1,495 s. Of that, the node part
  was 630 to 664 s (its "duration_ms"), so test:shell was the larger half.
- Probe run 36412608975 (macos-latest, each part alone):
  - the node suite: 517 s (job 557 s, 3 cores);
  - test:shell: 185 commands, 1,021 s in all, 77 of them bash -n or sh -n syntax checks. A long tail
    dominates: test-browser-check-surface-map 138 s, test-tunnel-handshake-gate 117 s,
    test-deploy-site-served-win-3600 103 s, test-bc-surface-map 83 s, test-browser-check-surface-gate
    76 s.
- One command exited 1 in the probe (test-cut-sign-preflight). Reproduced on the runner: the probe
  had written each command's output into the repository root, and that test scans the repository for
  the signing team id outside lib/signing-identity.sh, so it found its own output. It is a probe
  artifact, not a test problem. The shard runner writes nothing into the checkout.

## Build
- tools/shell-shard.js reads test:shell's commands from package.json (split on " && "). It assigns
  each to shard (sha256 of the command, mod n) + 1, and runs a shard's commands with sh -c from the
  repository root, in order, stopping at the first failure, as the && chain does. An empty shard
  refuses. SHELL_SHARDS = 2.
  - A hash, not a hand list, so a new command lands in a shard with nothing to edit.
  - Measured balance at 2 shards: 464 s and 557 s of shell time (a greedy split would be 511/511,
    but it needs the timings kept up to date).
- tools/run-tests.sh: KOSMOS_TEST_PART = all (the default, what `yarn test` runs, unchanged), node or
  shell; KOSMOS_SHELL_SHARD = i/n runs one shard. An unknown part exits 2 before running anything.
  Every part keeps the coverage, launchd, temp-root and leak guards.
- .github/workflows/test.yml:
  - a `suite` job over a matrix (node; shell 1/2; shell 2/2), fail-fast off, each with
    timeout-minutes 45;
  - a "how close to the limit" step (if: always()) that writes the job's wall time against
    SUITE_TIMEOUT_MIN to the job summary and raises a ::warning:: at 70% or more; the clock starts
    in the job's first step;
  - a `test` job that needs `suite` (if: always()) and is green only when every suite job was. So
    the check named `test` that people and tools read is still there.
- engine/shell-shard-4317.test.js:
  - the partition (at SHELL_SHARDS and at 2, 3 and 4 shards, disjoint and complete, no empty
    shard);
  - order-independence, and the refusals;
  - that the matrix runs the node part once and shards 1..SHELL_SHARDS once each;
  - that SUITE_TIMEOUT_MIN equals timeout-minutes, and the warning's 70% and always();
  - run-tests.sh's default of all.
  - Mutations seen red: dropping shard 2/2 from the matrix; SUITE_TIMEOUT_MIN 30 against 45.

## Measured on the runner (the real test.yml on this branch, via a temporary push trigger, since reverted)
- Run 36415011074 (ec4a9eb): three source pins went red. #1934, #3605 and #4273 find the suite by
  `^node --test`, and the line had been indented inside the new part check. It is flush left
  again (225a6e8), and the #4317 test pins that.
- Run 36416362440 (225a6e8): **success**.

  | job | wall time | share of its 45 min |
  |---|---|---|
  | node | 719 s | 27% |
  | shell 1/2 | 514 s | 19% |
  | shell 2/2 | 638 s | 24% |

  The whole suite now finishes in about 12 min of wall time, against 24 to 28 min before. 11142
  node tests ran.

## Decided
- Three jobs: the node part (about 9 min) and two shell shards (about 8 and 9.5 min). One node job
  is well under the bar, so the node files are not split; SHELL_SHARDS is one number to raise.
- Rejected:
  - Hand-listing the slow shell tests into their own job: the list goes stale as tests change.
  - Sharding the node files as well: not needed today, and it adds a second partition to keep.
  - Lowering timeout-minutes: the card's bar is a share of the limit; 45 keeps the hang-guard.

## Weakest part
- A hash does not balance by time. A new slow shell test could land on the larger shard, and the 70%
  warning is what catches that before it cancels.
- Running each shell command with sh -c rather than inside yarn's single `sh -c` of the whole chain.
  Every command is its own process in both cases; what differs is yarn's npm_* environment, which no
  test reads (checked: no test:shell command references npm_ or INIT_CWD).
