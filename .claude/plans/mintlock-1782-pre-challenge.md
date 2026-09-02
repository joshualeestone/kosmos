---
pre_challenge: true
method: challenge-loop
branch: mintlock-1782
diff_hash: 165be424d57b21ce3ac8f64da1570f7888cf692e8ac84cee983d83b7fc5d8092
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T04:31:27Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration-2 blind pass: no lost-token/wedge in the lock core; iteration-3 focused umask pass: no wedge/loss under any umask, one inert residue found and closed)
**Total findings:** 3 real defects in the first hand-rolled lock (iter 1->2), 2 umask defects (iter 2->3), 1 inert-litter residue (iter 3, closed). All fixed.

> Note on the diff_hash: the shared main checkout's local `main` ref is stale, so the hook's
> `git diff main...HEAD` three-dot spans other already-merged work. The hash above is exactly what
> the hook recomputes. The feature diff (vs origin/main) is two files: `engine/sendertoken.js` and
> `engine/sendertoken.test.js`, plus this plan.

## The feature (a CONCURRENCY fix in a credential store)

kosmos#1782: `sendertoken.js` `mint`/`retire`/`revoke` are read-modify-write on one per-session
token file; two PROCESSES that interleave lose a token silently. `withSessionLock(sessionName, fn)`
serializes the critical section across processes.

## Verification

Full suite green on the rebased tree (`node --test engine/*.test.js *.test.js` + `test:shell`):
EXIT_CODE=0, 3709 passes, 0 failures, 9 lock arms. `sendertoken.test.js` alone: 44 pass, 0 fail.
Rebased onto origin/main, 0 behind, empty overlap with sendertoken.

(A prior full-suite run showed 5 reds in time-sensitive release-gate/versions-entry tests -- those
passed 22/0 in isolation and were contention from a concurrent review agent, not this change.)

## Per-Iteration Breakdown

#### Iteration 1
First hand-rolled lock (pid-liveness stale-break, unlink+rmdir). All arms passed; the concurrent
12-process arm reproduced the defect (7 of 12 tokens lost with the lock removed).

#### Iteration 2 (three real defects, all in recovery paths)
Blind pass found three bugs chat.js's `withThreadLock` (round 19) had already fixed:
1. the `rmdir` stale-break lets two waiters both break and both proceed -> a lost token, through the
   repair path. Now STOLEN BY RENAME (succeeds once).
2. a crash between mkdir and writing the owner leaves an owner-less lock no liveness check can break
   -> permanent wedge. Staleness is now BY AGE.
3. `revoke` (the create.js new-agent security gate) bypassed the lock -> a straggler mint could
   resurrect a revoked token. `revoke` now takes the lock; `retire` calls a lock-free `revokeUnlocked`.
Plus `Number.isFinite` for `AGENT_WORKFORCE_LOCK_MS='0'` and the ELOCKBUSY code on retire.
The lock was replaced with chat.js's proven design, transcribed (kosmos#1823 tracks extracting the
shared primitive, which must touch chat.js -- circular via status.js -> sendertoken).

#### Iteration 3 (converged; two umask defects + one inert residue)
The iteration-2 review asked for an explicit umask-wedge arm. Adding it found the lock unusable
under a restrictive umask, in two places:
- `mkdirSync(lock)` lands the dir un-writable (owner file can't be created) -> chmod dir 0o700.
- `writeFileSync(owner)` lands the file 0o066 (owner can't READ) -> the release's readFileSync
  throws, the lock is not removed, the next op wedges -> chmod owner file 0o600.
A focused umask blind pass then confirmed no third surface (four mints across the full umask range
all survive; both chmods individually load-bearing; degrades safely on a chmod failure). It found
one INERT residue: a crash-between-mkdir-and-chmod under a restrictive umask leaves an un-readable
lock that, when stolen, leaves a `.stale` aside dir (rmSync can't readdir it). No token loss, no
wedge; closed by a best-effort chmod of the aside before the remove.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 2 | BLOCKER | stale-break | rmdir lets two waiters both proceed -> lost token | FIXED (rename-steal) |
| 2 | 2 | BLOCKER | acquire | crash before owner-write wedges the session | FIXED (age staleness) |
| 3 | 2 | WARNING | revoke | bypassed the lock -> resurrect a revoked token | FIXED (revoke wrapped) |
| 4 | 3 | BLOCKER | lock dir | un-writable under a restrictive umask -> wedge | FIXED (chmod dir 0o700) |
| 5 | 3 | BLOCKER | owner file | un-readable under a restrictive umask -> wedge | FIXED (chmod owner 0o600) |
| 6 | 3 | NIT | aside | inert .stale debris under a restrictive umask | FIXED (chmod aside) |

### Strengths
- The lock is chat.js's proven design, not a re-derivation; the shared-primitive follow-up is carded (#1823).
- 12-concurrent-process arm reproduces the defect the card said was unmeasured (with the lock all survive, without it 7 of 12 lost).
- Every guard mutation-verified red-on-revert; the umask handling proven across the full umask range.
- No em dashes in the added comments or tests (ASCII throughout).
