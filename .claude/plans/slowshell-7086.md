# slowshell-7086: cut the slowest shell tests in the full validation (kosmos#7086)

## Measured (before)
Six full validations, 10-21 to 10-24: node part 8 to 19 min (parallel), shell part 26 to 43 min
(286 commands, one at a time). Slowest shell files, stable across runs: test-queued-heavy-4977
(415 to 442 s), test-staging-agent-online-check (137 to 352 s), test-deploy-site-served-win-3600
(47 to 326 s), test-ci-runner-setup-4601 (222 s), test-publish-r2-3725 (97 to 164 s),
test-deploy-site-promote (about 100 s).

Per-file times on this box, quiet, traced with `PS4='+${SECONDS} ${LINENO}: ' bash -x`:

| file | before | after | where the time was |
|---|---|---|---|
| test-queued-heavy-4977 | 417 s | 226 s | one arm (`run5923 unw`) waited 240 s for its alarm |
| test-staging-agent-online-check | 380 s | 325 s | `run_case` slept the production minute on a lost create |
| test-deploy-site-served-win-3600 | 156 s | unchanged | 47 real deploy-site runs, about 3.3 s each (no waits) |
| test-ci-runner-setup-4601 | 224 s | unchanged | launchd throttle wait (+5 s, by design) and bootstrap backoff |
| test-publish-r2-3725 | 102 s | unchanged | 85 pwsh starts of publish-r2.ps1, about 1 s each |
| test-deploy-site-promote | 110 s | unchanged | real runs; zeroing its retry sleep saves only 9 s |

## Change
- test-queued-heavy-4977: the unwritable-marker-dir arm runs with a 15 s deadline. The wrapper waits
  for a turn it cannot take in that dir; the line the arm reads is printed before the wait.
- test-staging-agent-online-check: `run_case` passes `KOSMOS_AOC_LOST_TRIES=3 KOSMOS_AOC_LOST_GAP=0`
  (the existing seam), before the case's own variables so a case can override it.

## Decided
- No change to product code, and no arm removed or merged.
- Not cut: the ci-runner-setup throttle wait (the product waits the loaded throttle plus 5 s on
  purpose; lowering the fixture's throttle sends the arm down the "not done" path instead).
- Not cut tonight: served-win and publish-r2 cost real runs per arm; cutting them means fewer runs
  (merging arms) or one pwsh process for many arms, a refactor of how those files work.
- The bigger lever is structural: the shell part runs its commands one at a time. Running it as
  parallel shards locally (shell-shard.js already shards for CI) is measured separately before
  anything is proposed, because shell tests on one shared Mac may collide.

## Weakest premises
- The 15 s deadline assumes the wrapper prints the unchecked-lib line within 15 s under load. If a
  loaded box is slower, the arm goes red (never falsely green: its assertion is unchanged).
- The staging cases pass with 3 immediate re-asks today; a future case that needs the board to list
  an agent on a later ask must set its own KOSMOS_AOC_LOST_TRIES/_GAP.

## Validation
- Each changed file run alone on this box after the change: queued-heavy 142 OK / 0 BAD, staging
  online-check 68 PASS / 0 FAIL (same counts as before the change).
