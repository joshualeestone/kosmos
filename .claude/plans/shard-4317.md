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
  shell; KOSMOS_SHELL_SHARD = i/n runs one shard. A part other than all is honoured only in CI
  (GITHUB_ACTIONS=true) or with KOSMOS_TEST_PART_LOCAL=1, so a value inherited from a shell cannot
  narrow a release cut's or a validation's `yarn test`; a part always prints a line saying so. An unknown part, a shard that is not i/n, a shard
  outside a shell-only run, or node --test arguments to a shell-only run exits 2 at the top of the
  file, before the machine claim, the temp root or any test. The test RUNS each refusal, with stub
  node and yarn on the PATH so a missing refusal fails at once instead of running the suite.
  Every part keeps the coverage, launchd, temp-root and leak guards.
- .github/workflows/test.yml:
  - a `suite` job over a matrix (node; shell 1/2; shell 2/2), fail-fast off, each with
    timeout-minutes 45;
  - a "how close to the limit" step (if: always()) that writes the job's wall time against
    SUITE_TIMEOUT_MIN to the job summary and raises a ::warning:: at 70% or more; the clock starts
    in the job's first step;
  - a `test` job that needs `suite` (if: !cancelled(), so a superseded run still reads as
    cancelled) and is green only when every suite job was. So the check named `test` that people and
    tools read is still there.
- tools.shell-shard-4317.test.js:
  - the partition (at SHELL_SHARDS and at 2, 3 and 4 shards, disjoint and complete, no empty
    shard);
  - order-independence, and the refusals (a bad shard, a shell part given node --test arguments);
  - every command is one plain script call whose script exists (so a quote, a ; or a nested && fails
    the test rather than being mis-cut);
  - a shard runs in order and stops at the first failure with its exit status (runShard; a marker
    file after the failure must not appear);
  - run-tests.sh's shard arm RUNS the shard, and refuses a bad shard;
  - that the matrix runs the node part once and shards 1..SHELL_SHARDS once each;
  - that SUITE_TIMEOUT_MIN equals timeout-minutes, and the warning's 70% and always();
  - run-tests.sh's default of all.
  - Mutations seen red: dropping shard 2/2 from the matrix; SUITE_TIMEOUT_MIN 30 against 45.

## Measured on the runner (the real test.yml on this branch, via a temporary push trigger, since reverted)
**Run of record: 36429871904**, on commit 2bc46cc, which is 10b46e6 (the code as it merges) plus
the temporary push trigger, since dropped from the branch. Success:

| job | wall time | share of 45 min |
|---|---|---|
| node | 705 s | 26% |
| shell 1/2 | 554 s | 21% |
| shell 2/2 | 645 s | 24% |

11264 node tests ran; each part logged its "running ONLY" line; 22 min end to end.
The earlier runs below are evidence from before later changes. **Earlier:** (a merge
of main, which changed run-tests.sh's node --test line in #4326, orphaned the earlier runs as a
measurement of the head's code). The runs below are earlier evidence; each names the code it ran,
and the commit the runner actually checked out when that was a temporary trigger commit on top.
- Run 36415011074 (the code at ec4a9eb, run as TEMP commit c025ca6): three source pins went red. #1934, #3605 and #4273 find the suite by
  `^node --test`, and the line had been indented inside the new part check. It is flush left
  again (225a6e8), and the #4317 test pins that.
- Run 36416362440 (the runner checked out 225a6e8 itself; the trigger came from TEMP commit c025ca6
  below it): **success**.

  | job | wall time | share of its 45 min |
  |---|---|---|
  | node | 719 s | 27% |
  | shell 1/2 | 514 s | 19% |
  | shell 2/2 | 638 s | 24% |

  Run 36419129296 (the code at c07e463, run as TEMP commit 07a1e10, after review round 1): success again. node 697 s (26%), shell 1/2
  481 s (18%), shell 2/2 681 s (25%).
- Run 36423468035 (the code at ddb3e41, run as TEMP commit 260b9cd; the iteration 4 code, rebased
  on main before #4326): success, every shard green.

  | job | wall time | share of 45 min |
  |---|---|---|
  | node | 294 s | 10% |
  | shell 1/2 | 461 s | 16% |
  | shell 2/2 | 573 s | 21% |

  All 11237 node tests ran (0 failed, 165 skipped), so the short node time is a faster runner, not
  fewer tests. End to end it took 38 min, because the node job waited about 25 min for a macOS
  runner. The job times are the card's bar; the queue is the runners' supply.
- **Wall time depends on free runners.** Run 36416362440 took 12 min 13 s end to end, with all
  three jobs starting together. Run 36419129296 took 19 min 56 s, because shell 1/2 waited 11 min
  39 s for a macOS runner (it started after the other two had finished). Run 36423468035 took 38
  min, its jobs running almost one after another while they waited for runners. No job's own time
  came near its limit; how long a whole run takes depends on how many macOS runners are free.
  11142 and 11144 node tests ran in the first two, 11237 in the third (main grew).

## Decided
- Three jobs: the node part (4.9 to 12 min measured) and two shell shards (7.7 to 8.6 min and 9.6 to
  11.4 min measured). One node job
  is well under the bar, so the node files are not split; SHELL_SHARDS is one number to raise.
- Rejected:
  - Hand-listing the slow shell tests into their own job: the list goes stale as tests change.
  - Sharding the node files as well: not needed today, and it adds a second partition to keep.
  - Lowering timeout-minutes: the card's bar is a share of the limit; 45 keeps the hang-guard.

## Weakest part
- The timings are three runs of this branch through a temporary push trigger, one of them on the
  head's own code (36423468035), not yet main. The first main runs after merge are the confirmation, and each job's summary line reports
  its share.
- A run now holds three macos-latest runners instead of one (#3499's contention was about those).
  Queue time is not part of timeout-minutes, so it cannot cancel a job; it can delay the result.
- Latency down, machine time up. Each job pays its own checkout, tmux install and node setup, and
  runs the guards (coverage, leak checks, both browser-check gates) itself, so a run uses a few more
  runner-minutes in total than one job did. The result arrives faster only when three macOS runners
  are free at once (12 min in run 36416362440); when they are not, it can take longer than the one
  job did (38 min in run 36423468035). The card's bar is each job's share of its limit, which holds.
  The repo is public, so the minutes are not billed.
- A hash does not balance by time. A new slow shell test could land on the larger shard, and the 70%
  warning is what catches that before it cancels.
- Running each shell command with sh -c rather than inside yarn's single `sh -c` of the whole chain.
  Every command is its own process in both cases; what differs is yarn's npm_* environment, which no
  test reads (checked: no test:shell command references npm_ or INIT_CWD).
