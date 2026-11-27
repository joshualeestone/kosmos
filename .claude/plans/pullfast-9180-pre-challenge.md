---
pre_challenge: true
method: challenge-loop
branch: pullfast-9180
diff_hash: cb885e6f5c35043d56338999bc3f57dc4b68d23d5b8391eda3b754c65c0501b3
validation: passed (this Mac, tools/run-tests.sh alone, KOSMOS_SUITE_MAX=1) at 3f98a52d9e, ended 21:51 CST: 31,633 node tests 0 failed, all four shell shards status 0; validation-log hash cb885e6f5c35 equal to diff_hash. Before queueing: the static set from the worktree 4,171/4,171 (it caught #3628's rule on the new CLI test, fixed) and the browser-check surface gate rc 0.
subdir_audit: passed
timestamp: 2026-11-27T03:51:35Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet), each over the whole branch.
**Converged:** Yes. Round 4 found only NITs (three printed lines that could be untrue), each fixed with a test.

### Iteration 1 (opus)
- [CRITICAL] two same-day objects of one install write one file and both stayed indexed, so the survivor was skipped for ever with the deleted one's content --> FIXED (a write un-indexes every other object saved in that file)
- [IMPORTANT] a token that lost read access passed when everything was already here --> FIXED (a read-back check when the pull read nothing)
- [IMPORTANT] the index was 0644 --> FIXED (0600 file, 0700 folder)
- [IMPORTANT, test] the CLI test could not prove the seam's token reached the store --> FIXED (the stand-in store refuses any other token)

### Iteration 2 (sonnet)
- [IMPORTANT] the read-back check failed a healthy pull on any error --> FIXED (only a refused read fails it; others try the next held report)
- [IMPORTANT, test] two assertions passed on the check's own read --> FIXED
- [IMPORTANT] "none was pulled" overstated a complete folder --> FIXED
- [NIT] a pull killed mid-write could leave a wrong index entry --> FIXED (the index is saved without the files about to be written, before any write)

### Iteration 3 (opus)
- [IMPORTANT] a comment overclaimed concurrent safety --> FIXED as a stated limit (two pulls into one folder inside the collect route's two-objects window; --all repairs it)
- [NIT] wording of two messages, a stray no-op --> FIXED

### Iteration 4 (sonnet)
- [NIT] progress counted failed reads as fetched; "nothing new" when nothing was new; a silently unmade token check --> FIXED, each with a test

Every site perturbed alone turns its own test red (recorded per round in .claude/plans/pullfast-9180.md).
