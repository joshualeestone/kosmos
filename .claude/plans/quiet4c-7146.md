# quiet4c-7146: arm 4c of test-shell-parallel-7100.sh stops printing "run-tests: interrupted" into passing logs (kosmos#7146)

## Why
Every run of tools/test-shell-parallel-7100.sh printed two lines, "run-tests: interrupted; the last lines of
shard-1.log" and the same for shard-2. They land in every full validation log that runs test:shell, passing ones
included (seen in val-7130.log, 15:02 CDT 2026-10-25, a green 4-shard run). In a green log they read like a failure.

## Change
Arm 4c starts its stub runner with stderr sent to `$T/l4c.err`, as arm 4b does. It was the only arm that starts that
runner without a redirect: checked on origin/main, where every other start of runner.sh redirects (4b to a file; 4d,
4e, 4f, 4g and 4j to /dev/null). What the arm asserts is unchanged, and its failure message now carries the first 300
bytes of that stderr, as arm 4b's does, so a real failure still shows its cause.

## Validation
- The fixed file passes all 27 arms and prints no "run-tests: interrupted" line.
- Control: the same file with only this change reverted prints exactly two.
- A first control against the main checkout also printed none. That checkout was behind origin/main (a3b3fa5fc2 against
  cc4a0117e0), so it was the wrong subject, which is why the control above reverts the one line in this tree instead.

## Weakest premise
The stop path's stderr in arm 4c is no longer seen. That arm asserts on process state, not on that output; arm 4b
still checks the tails reach stderr.
