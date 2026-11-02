---
pre_challenge: true
method: challenge-loop
branch: pbskips-7404
diff_hash: 93413cb597e1b407fe91c65d92732acb9095c36ba3c72bd465cfe791c58b3fb0
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T06:56:47Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5, blind, opus and sonnet rotated
**Converged:** Yes (iteration 5 raised one WARNING, a deliberate behaviour that is tested)

Validation: full `validation_log_run_or_skip` on Mortals at 3c16ca390, hash 93413cb597e1, passed, after a rebase over sealworker-7746 (one conflict, the same return line; both kept). The earlier pass at 4e142b2a2 predates that rebase.

## What each iteration changed

Read from the iteration commits' diffs at proof time. The review reports themselves did not survive a restart, so
this names what was fixed, not each reviewer's wording. Which model ran which round is not recorded here.

### Iteration 1

e8c6ab8833: `leftOut` renamed `skippedFiles`. The list is kept across a failed run, and a stop or a good run with
   no list no longer shows an older one. `report()` gives it on the plain good state only. Test added for the 200 limit.
### Iteration 2

9fcfa48a3d: the list is newest first, so a folder of links cannot push a film off it. A run that failed under
   another enrollment no longer carries that enrollment's list. `skippedList` documented on the result.
### Iteration 3

eb4dbed16b: the comment states what happens past MAX_SKIPPED. The test now asserts the first entry, not any entry.
### Iteration 4

4e142b2a29: the mixed test uses a real film beside a kept small file. Comments: 200 is a guess; reasons are short
   text, not only the scanner's fixed ones.
### Iteration 5

[WARNING] One, a deliberate behaviour that is tested. No change.
