# launchprune-5765: the sandbox-ceiling test is past the limit on Linux too

Card: joshualeestone/kosmos#5765 (found by #5500's Linux lane run 38033565561).

## What finished looks like
engine/launchprune-5663.test.js "a sandbox layer past the measured ceiling is a warning" passes on the Linux lane as it does on macOS, and its failure message says what was written.

## Cause (measured)
The size check counts each clause's distinct paths. On macOS every rule is written in two spellings (/var and /private/var, /tmp and /private/tmp), so the 1400 test entries count twice and pass the raw limit (160 KiB) even under a short temp folder: measured with TMPDIR=/tmp, denyWrite 110k characters plus the Edit targets in the other spelling, warning raised. On Linux the spellings are one, so the same entries under /tmp come to about 100k: under the limit, no warning, red. Not the platform passed in (BASE already names darwin) and not a code defect: the product measures what the sandbox would get.

## Change (test only)
- Each test entry carries a 100-character segment, so one spelling is past the raw limit on any platform (macOS measured: 308k in the write clause).
- The failing assertion's message reports what was written (counts, characters, temp root, a sample), so a red elsewhere says why without a rerun.

## Decided
- The limits and the product code are unchanged: the test's input was too small on Linux, the check was right.
- Weakest premise: the Linux total is estimated (about 218k to 240k, review 1's count and mine) against the 163,840 raw limit; the Linux lane run on this branch is the measurement.
