---
pre_challenge: true
method: challenge-loop
branch: gate-diag-3893
diff_hash: 825ffe612fcaed4f486c59a866fb55070bb9f559b6ce438fd49015a184317d5a
subdir_audit: passed
timestamp: 2026-09-26T05:18:36Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1. A DIAGNOSTIC draft PR, never to be merged; it exists only to make CI print the surface gate's git refs.
**Converged:** Yes, for its purpose.

## Iteration 1
- [BLOCKER] Must never merge: it forks at 54f56d7 on purpose (before #3890), and it adds debug output to run-tests.sh. It is a draft, titled DIAG, and closed after the run.
- [STRENGTH] The branch reproduces the failing shape exactly: a PR forked before a trailer-excused surface commit (#3890, 0a8bcc3e), run after that commit is on main.
- [STRENGTH] The diagnostic is read-only git (rev-parse, merge-base, rev-list, diff --name-only, for-each-ref) and prints at the suite start and immediately before the gate, so it shows whether refs change during the suite.
- [STRENGTH] Smoke-tested locally: `bash -n` is clean, and the function prints every line against this worktree.
- [WARNING] The gate only runs if the whole suite passes (NODE_STATUS 0). A red test on this old base would hide the second print. The start print still lands.
- [NIT] `HEAD^2` errors on a non-merge HEAD; that is printed, not fatal.
- [CONVENTION] No em dashes.

## Weakest premise
- That the CI condition reproduces on a fresh run. If the gate passes here, the refs at gate time are still printed, and those are the data either way.
