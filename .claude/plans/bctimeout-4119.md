# bctimeout-4119: the PR browser-checks job's time limit, 60 to 120 minutes

## Finished looks like
A page PR whose diff selects many checks (tools/bc-pr-select.js, #4119) finishes the browser-checks job and reports green or red, instead of being cut off at 60 minutes and reporting neither.

## Measured
- #5634 (conversation mode) touches openDetail, showTab, PJ_CURRENT and similar shared names. The selector named 146 checks, 131 of them beyond the 56-check allowlist, 187 planned in all. The job was cancelled at 60:27 (job 113639818096) with 185 started and 0 failed; it was cut on its last few checks.
- This workflow's last 60 runs: 43 success, 3 failure, 12 cancelled. Of the cancelled, 5 ended more than an hour after they were queued (queue time included, so not all of those are timeouts).

## Decision (Angel)
- Raise `timeout-minutes` to 120. It is reversible in one line, and the repo is public, so the macOS minutes cost nothing. A run that would have finished takes as long as it needs; a hung run is still stopped.
- Rejected: narrowing the selection. It is #4119's (Scorpion's) design and catches real regressions (the 09-26 render-talk and render-fields breaks).
- Rejected: merging #5634 without the selected checks. They exist so the author sees a break before the cut.
- Rejected: sharding the job. That is a larger change, worth doing if 120 is ever reached; it is noted for #4119.

## Weakest premise
That 120 stays enough. The worst case is a PR that selects every check, which is what the nightly full step runs: 84 to 94 minutes on the same runner from 10-03 to 10-08, about 25 minutes inside 120 today. That margin shrinks as checks are added (84 to 94 in five days). Past about 115 minutes, shard the job (#4119).

## Review log
- **Round 1 (sonnet):** 0 blockers, 0 warnings.
  - CONVENTION fixed: the check is advisory (the file's header), so a cut-off run gives no verdict rather than blocking a merge. What blocks is an author's own merge-on-green wait.
  - NITs: the comment is collapsed to one history line, and the queue-time evidence is moved to this plan only (most of those cancels are likely concurrency cancels; #5634's 60:27 is the one measured timeout).
  - Decided: no step-level limit on the driver, since a hung check is still stopped at 120.
- **Round 2 (opus):** nothing above NIT, CONVERGED.
  - The worst case was measured from the nightly full step (84 to 94 min), and the numbers corrected (131 beyond the allowlist, cut on its last checks); both are in the plan, and the bound is noted in the yml.
  - Decided: no guard test pinning the value, and the pre-#4119 prose is left as history.
