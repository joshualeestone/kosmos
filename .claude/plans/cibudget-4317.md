# cibudget-4317: raise test.yml's job timeout 30 -> 45 min (kosmos#4317)

## Why
Measured with `gh run view` on 2026-09-28: main's `test` job ran 23.5, 23.5, 20.9, 22.7 and 19.8 min in its last
five green runs. The 30-minute cap therefore leaves ~6 min for any branch. #4307 (#4270) was CANCELLED at
30:21, and a cancel reads as a failure.

## What
`.github/workflows/test.yml`, job `test`: `timeout-minutes: 30` -> `45` (~2x the runtime again, the same
reasoning the comment already used for 15 -> 30), plus a comment with the numbers.

## Checked
- Ruby YAML parse: `jobs.test.timeout-minutes` = 45, a job-level key; no step in the job has its own timeout.
- No test pins this value. The timeout tests read windows.yml and browser-checks*.yml; the test.yml readers
  pin concurrency, fetch-depth and triggers only.

## Not done (decided by Splinter on #4317)
Sharding the job, with a warning at 70% of the timeout, is #4317's follow-up.
