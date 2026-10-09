# bctimeout-4119: the PR browser-checks job's time limit, 60 to 120 minutes

## Finished looks like
A page PR whose diff selects many checks (tools/bc-pr-select.js, #4119) finishes the browser-checks job and reports green or red, instead of being cut off at 60 minutes and reporting neither.

## Measured
- #5634 (conversation mode) touches openDetail, showTab, PJ_CURRENT and similar shared names. The selector added 146 checks to the allowlist. The job was cancelled at 60:27 (job 113639818096) with 185 checks passed and 0 failed; the new check had not been reached.
- This workflow's last 60 runs: 43 success, 3 failure, 12 cancelled. Of the cancelled, 5 ended more than an hour after they were queued (queue time included, so not all of those are timeouts).

## Decision (Angel)
- Raise `timeout-minutes` to 120. It is reversible in one line, and the repo is public, so the macOS minutes cost nothing. A run that would have finished takes as long as it needs; a hung run is still stopped.
- Rejected: narrowing the selection. It is #4119's (Scorpion's) design and catches real regressions (the 09-26 render-talk and render-fields breaks).
- Rejected: merging #5634 without the selected checks. They exist so the author sees a break before the cut.
- Rejected: sharding the job. That is a larger change, worth doing if 120 is ever reached; it is noted for #4119.

## Weakest premise
That 120 is enough for the largest selections: 146 extra checks took more than 60 minutes; measure the next large run's length.

## Review log
