# mintlock-1782: serialize sendertoken mint/retire with a per-session lock

## The defect (kosmos#1782)

`engine/sendertoken.js` `mint()` and `retire()` are read-modify-write on one per-session token
file:

    tokens = readTokens(session)   // read
    ... append / filter ...        // modify
    writeTokens(session, tokens)   // write (atomic file replace, via securewrite)

`writeSecret` makes each WRITE atomic; it does NOT make the read-and-write atomic. Two PROCESSES
that interleave between the read and the write lose a token: the second write is built from a list
that predates the first, so a live agent's token vanishes silently. This module exists to make
duplicate launches visible, so a silently-lost token is exactly the case it must not produce.
Same-process callers cannot hit it (`writeSecret` is synchronous); two processes are a real launch
pattern. Pre-existing; not introduced by #1761/#1787 (those made the WRITE atomic, one layer down).

## The fix

`withSessionLock(sessionName, fn)` wraps both critical sections. The lock is a DIRECTORY
(`mkdirSync` is atomic and fails EEXIST if it exists, which is the cross-process mutual exclusion),
holding an `owner` file with the holder's pid. Semantics:

- A lock left by a CRASHED holder is broken by liveness (`process.kill(pid,0)` throws ESRCH), so a
  crash cannot deadlock every future mint.
- A lock held by a LIVE holder is waited on (`Atomics.wait`, a synchronous park), and if it will
  not clear by the deadline, mint/retire FAIL (ELOCKBUSY) rather than break it -- breaking a live
  holder's lock to force progress would reintroduce the lost update. Same "act only on a process
  you can prove is dead" rule as the securewrite reaper (#1793); a reused pid reads alive and we
  wait, which fails safe.
- The deadline is `AGENT_WORKFORCE_LOCK_MS` (tests) or 2000ms.
- Release is `unlink(owner)` + `rmdir(lockPath)`, NOT a recursive rm: a recursive rm on macOS can
  race and leave the directory, which then trips a later recursive cleanup.

Under normal concurrent launches the lock serializes them (each waits ms for the other and both
succeed); ELOCKBUSY is a rare safety valve for a holder stuck past the deadline.

`revoke()` (a plain, atomic unlink of the whole file) is deliberately NOT under the lock: it has no
read-modify-write lost-update, and a mint racing a deletion is inherently ambiguous by intent.

## Tests

Each arm uses its own session name. Deterministic mechanics arms, each mutation-verified
red-on-revert:
- mint FAILS SAFE and leaves the store unchanged when a LIVE process (pid 1) holds the lock
  (reddens if mint's lock wrapping is removed).
- mint BREAKS a lock left by a CRASHED (dead-pid) holder and succeeds (reddens if the stale-break
  is disabled -- it then waits to the deadline and returns ELOCKBUSY).
- mint RELEASES the lock on success (no leak).
- retire is serialized on the SAME lock (reddens if retire's lock wrapping is removed).
- **12 CONCURRENT PROCESSES minting the same agent lose NO token** -- the defect reproduced across
  real processes, the case the card said had not been measured. Measured: with the lock all 12
  survive; with the lock removed, 7 of 12 were lost.

Full `sendertoken.test.js`: 41 pass, 0 fail; full suite green.
