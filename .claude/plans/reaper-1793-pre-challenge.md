---
pre_challenge: true
method: challenge-loop
branch: reaper-1793
diff_hash: 8eb4f6691a968d17e9d04d28a2863114ab3f7dcae1a6f7f01a9d532357c41b53
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T03:29:10Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 2 blind pass found no product defect; iteration 3 applied that pass's one test-integrity fix, mutation-verified)
**Total findings:** 1 real (latent) product defect (fixed in iter 2), 1 test-integrity gap (fixed in iter 3).

## The feature (a SECURITY fix, DELETE path)

kosmos#1793: `engine/securewrite.js` leaves an orphan temp
`<file>.kosmos-<pid>-t<threadId>-<started>-<seq>.tmp` holding the secret if a process dies between
the `wx` create and the `renameSync`. `forget()` never removes it, so a stale token outlives its
own revoke, re-connect and uninstall. `reapOrphanTemps(dir)` (called from `writeSecret`, once per
target directory per process) reaps orphans, deleting ONLY a temp it can prove is dead: our
`(pid, threadId)` with a different STARTED, or a foreign pid that is provably gone (ESRCH). A
same-pid temp from a different threadId (a possible live sibling worker), a foreign LIVE pid, and
our own current temp are all LEFT -- so it can never take a concurrent writer's in-flight temp, the
race the module's own comment warned a glob sweep would create. Regex-anchored to the
`.kosmos-...tmp` suffix a credential file cannot carry; best-effort and never fatal.

## Verification

Full suite green on the rebased tree (`node --test engine/*.test.js *.test.js` + `test:shell`):
EXIT_CODE=0, 3681 passes, 0 failures, 8 reaper arms run. `securewrite.test.js` alone: 28 pass, 0
fail. Rebased onto origin/main (713d397e), 0 behind, clean merge, empty overlap with securewrite.

## Per-Iteration Breakdown

#### Iteration 1
The reaper with a `(pid, STARTED)` identity. Five arms, each in its own fresh directory (the reap
is once-per-dir-per-process): prior-run reaped, dead-foreign reaped, LIVE-foreign LEFT,
credential-with-no-suffix untouched, and the write still lands. Mutation-verified: removing the
reap call reddens the three presence arms; widening the predicate reddens the live-foreign arm;
widening the regex reddens the credential arm.

#### Iteration 2 (a real, latent defect)
Blind pass found the `(pid, STARTED)` invariant is FALSE under `worker_threads`: sibling threads
share `process.pid` but each has its own module-level STARTED, so a live worker's in-flight temp
would read as "a prior run of us" and be deleted mid-write. Not triggerable in-tree today (no
worker_threads use; securewrite loaded only main-thread), but the "never takes a live temp" claim
was false. Fixed: the identity is now `(pid, threadId)`, which names exactly one live thread; the
temp name carries `t<threadId>` and the regex accepts the old no-`t` form for upgrade back-compat.
Two arms added (a same-pid different-thread temp is LEFT; an old-format prior-run temp is still
reaped); dropping the threadId check reddens the different-thread arm.

#### Iteration 3 (converged; a test-integrity fix)
The iteration-2 blind pass confirmed NO product defect and verified all five over-deletion cases
safe, back-compat sound, and never-fatal. Its one finding was that the credential-safety arm could
not redden under the regex widening its own comment prescribed: a no-digit fixture parses to pid
NaN and is left by the numeric backstop, so the arm credited the anchor while resting on the parse
(the product was double-protected; the test was not pinning the named guard). Fixed: the sibling
credential now ends in digits that parse to a real DEAD pid but carries no `.kosmos`/`.tmp` anchor,
so loosening the anchor reaps it and the arm reddens. Mutation-verified: making the anchors
optional reddens this arm while real-temp arms stay green.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 2 | BLOCKER (latent) | securewrite.js reaper | (pid,STARTED) deletes a live sibling worker's temp under worker_threads | FIXED (threadId identity) |
| 2 | 3 | NIT (test-integrity) | securewrite.test.js credential arm | fixture could not redden on anchor loosening (NaN backstop) | FIXED (digit-tail dead-pid fixture) |
| 3 | 2 | STRENGTH | securewrite.js reaper | all five over-deletion cases verified safe; never-fatal; regex anchor sound | VERIFIED |

### Strengths
- Deletes only a temp provably dead; a live thread's temp is never taken, by construction.
- Identity is (pid, threadId), which uniquely names a live thread; back-compat for old-format temps.
- Every arm in its own fresh dir; each guard mutation-verified red-on-revert, including the two over-deletion safety guards and the anchor guard.
- No em dashes in the added comments or tests (ASCII throughout).
