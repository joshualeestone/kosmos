# mintlock-1782: serialize sendertoken mint/retire/revoke with a per-session lock

## The defect (kosmos#1782)

`engine/sendertoken.js` `mint()`, `retire()` and `revoke()` are read-modify-write on one
per-session token file. `writeSecret` makes each WRITE atomic; it does NOT make the read-and-write
atomic. Two PROCESSES that interleave between the read and the write lose a token: the second write
is built from a list that predates the first, so a live agent's token vanishes silently -- the case
this module exists to make visible. Same-process callers cannot hit it (`writeSecret` is
synchronous); two processes are a real launch pattern. Pre-existing.

## The fix

`withSessionLock(sessionName, fn)` wraps the critical section of `mint`, `retire` and `revoke`.

The lock is chat.js's proven `withThreadLock` (round 19), TRANSCRIBED rather than reinvented: a
first hand-rolled version re-derived the primitive and a blind pass caught three bugs chat.js had
already fixed (below). The two locks should be one shared primitive, filed as **kosmos#1823** (it
must touch chat.js, required fleet-wide via status.js which requires this module, so extracting it
here is circular -- its own reviewed change).

Design:
- **Directory lock** (`mkdirSync` is atomic, EEXIST if held).
- **Broken when STALE BY AGE** (`LOCK_STALE_MS` = 10s): a lock older than the bound is debris from a
  crashed holder, so a crash between `mkdir` and the owner write -- an owner-less lock no liveness
  check could break -- is still collected. The critical section is a few file ops (ms), so anything
  older is not a live writer.
- **STOLEN BY RENAME**, not `rmdir`: two waiters can both measure a lock as stale; with `rmdir` both
  remove it and both proceed, the second demolishing the first's fresh lock. `rename` of a path
  succeeds ONCE; the loser gets ENOENT and loops. Rename also copes with a non-empty lock dir.
- **Owner token** written into the lock; release removes it only if still ours, so a holder whose
  section outlived LOCK_STALE_MS and was stolen does not delete the successor's lock.
- **chmod 0o700 after mkdir** -- a hardening the chat.js copy lacks and this needs: a restrictive
  umask (the #1761 umask test sets 0o600) leaves the lock dir un-writable, so the owner file cannot
  be written and the lock wedges. Found by that test failing.
- **Fail contract**: returns `{ok:true,value}` or `{ok:false,because}` (ELOCKBUSY), never throws for
  the lock; a `fn` throw propagates through the release. Deadline `AGENT_WORKFORCE_LOCK_MS`
  (Number.isFinite, honors 0) or 2000ms; `Atomics.wait` parks.

`revoke` (the new-agent security gate in create.js) now takes the lock, so a straggler mint cannot
land its write between the read and the unlink and resurrect a revoked token. `retire` calls a
lock-free `revokeUnlocked` (it already holds the lock).

## Tests

Each arm uses its own session name; the SANDBOX teardown gets `maxRetries` for the lock's dir churn.
Mutation-verified:
- mint FAILS SAFE and leaves the store unchanged under a FRESH held lock (reddens with the lock bypassed).
- mint STEALS a STALE (old-mtime) lock and succeeds (reddens if the age-break is disabled).
- mint steals a stale OWNER-LESS lock -- the crash-between-mkdir-and-owner wedge (reddens if age-break disabled).
- mint RELEASES the lock on success.
- retire and revoke are serialized on the SAME lock (redden with the lock bypassed).
- **12 CONCURRENT PROCESSES minting one agent lose NO token** -- the defect reproduced across real
  processes (the card said it had not been measured): with the lock all 12 survive; with the lock
  removed, 7 of 12 were lost.

Full `sendertoken.test.js`: 43 pass, 0 fail; full suite green.
