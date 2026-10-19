---
pre_challenge: true
method: challenge-loop
branch: putbackfast-5907
diff_hash: ef02c3e343048fb60654a92e143c90446fe03326541faca59d90740fce739b22
validation: passed
subdir_audit: passed
timestamp: 2026-10-14T08:21:23Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1: NITs only)
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Fixed:** 0 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full suite through tools/queued-heavy.sh at head 05016fdd (QUEUE_DONE rc=0 03:21 CDT): node 20,515 tests,
0 fail; shell 232 of 232; no leak; `validation PASSED ... hash=ef02c3e34304`, equal to this proof's hash.
The test inside that suite: 9.1 s (about 71 s in yesterday's loaded suite). Alone: 70.4 s on main, 10.5 s here, the
same 33 PASS lines in the same order (diffed).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**Self-generated:** not computed
- The reviewer read every case: without a board.pid the old loop only ran curl and sleep and changed no state, so no
  assertion relied on it; and the real kosmos stop never waits on the port (it waits on a pid when it has one).
- [NIT] the comment says "killed our own board"; it waits whenever a board.pid exists, even a stale one --> no change (behaviour as on main)
- [NIT] an empty board.pid no longer waits --> no change (no case writes one)
- [NIT] the fake writes board.stopped on the another-app branch where the real stop dies without it --> no change (existing, not introduced here)
**Converged** - no new actionable findings.

### How it was found (disclosed)
Two tracing attempts by environment (SHELLOPTS=xtrace) changed the test's own behaviour and were abandoned; the cause
was found by timestamps around each step of one case (12 s in the fake stop) and a bash -x of that one call, summed per
line (one loop line, 202 rounds, 13.85 s).
