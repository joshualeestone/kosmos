# qhflake-5839: the #5331 CONTROL arm stops flaking in CI

Card: joshualeestone/kosmos#5839. The arm "#5331 CONTROL: with the old teardown the same capper holds it" in
tools/test-queued-heavy-4977.sh went red twice in CI on 2026-10-11 (suite shell 2/2) on PRs unrelated to it.

## Finished looks like
- The arm no longer reds when the setup's stop missed its target; a run that never raced is retried once, not judged.
- Both #5331 arms say what they got (0 reaped / 1 hung / 2 never started), with the copy's log tail on a BAD.
- The guard is not weakened: a real regression (1 for the new teardown, 0 for the old) still fails.

## Decided
- The cause, read from the code (review 1): a second capper_of after the until_true could miss the capper between its
  `sleep 7`s and stop nothing. The pid now comes from the same look, and the stop is verified.
- Weakest premise: that this is the CI cause; it was never reproduced. The arms now print the value, so a recurrence
  names its shape.
