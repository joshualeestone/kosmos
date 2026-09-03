'use strict';

/* One shared file-lock primitive (kosmos#1823).
 *
 * chat.js's `withThreadLock` (round 19/40) and sendertoken.js's `withSessionLock`
 * (#1782) had each grown a copy of the same mkdir-atomic file lock. A blind pass on
 * the first sendertoken copy found three bugs in the recovery paths — where a lock
 * is most dangerous — that chat.js had already fixed. Rather than keep two copies of
 * a notoriously bug-prone primitive, this is the single home; both delegate here.
 *
 * The design, and why each part is the way it is:
 *
 *   - The lock is a DIRECTORY. `mkdirSync` is atomic and throws EEXIST if held, so
 *     acquisition needs no compare-and-swap of our own.
 *   - A stale lock is STOLEN BY RENAME, never by `rmdir`. Two waiters can both
 *     measure one lock as stale; with `rmdir` both remove it and both proceed — the
 *     second demolishing the first's brand-new lock and entering the section beside
 *     it, the exact interleave the lock exists to prevent, reached through the path
 *     that repairs it. Rename also copes with a non-empty lock dir a crash can leave
 *     (a `.DS_Store`, say), which `rmdir` cannot — that ENOTEMPTY once spun the
 *     synchronous POST handler forever.
 *   - THE STEAL VERIFIES IDENTITY BY INODE (kosmos#1991). It is tempting to think
 *     `rename` of a path succeeds only ONCE, so the loser gets ENOENT and re-waits.
 *     That holds only if both waiters rename at the same instant. A deschedule
 *     between the stat that measured staleness and the rename lets the OTHER waiter
 *     complete a full steal and re-acquire a FRESH LIVE lock at the path first;
 *     `rename` then moves that live lock aside and SUCCEEDS, and both proceed — the
 *     same double-entry `rmdir` had. So the stat captures the lock's mtime, and
 *     after the rename we confirm the moved dir carries that mtime; since staleness
 *     is itself an mtime bound, a stolen-stale lock's mtime is >LOCK_STALE_MS old
 *     while a re-acquired one's is ~now, so they cannot collide. A mismatch means we
 *     grabbed a lock we never measured stale, and we put it back and re-wait.
 *   - Staleness is by AGE, not owner liveness, so a crash between the `mkdir` and
 *     the owner write — an owner-less lock no liveness check could break — is still
 *     collected once it outlives LOCK_STALE_MS.
 *   - Release removes OUR OWN lock, never whoever's is there now. A token written
 *     into the lock makes ownership checkable: a holder whose section outlived
 *     LOCK_STALE_MS and was stolen must not delete the SUCCESSOR's fresh lock on the
 *     way out. Losing the marker (an unwritable dir) is not a reason to fail the
 *     write — it only means we cannot prove the lock is ours, so we leave it for the
 *     staleness rule to collect.
 *   - The lock dir and its owner file are chmod'd back to owner-only after creation
 *     (#1761): a restrictive umask otherwise leaves the dir without owner WRITE (the
 *     owner file cannot be created) or the owner file without owner READ (the
 *     release's read throws, `ours` is false, the lock is not removed, and the next
 *     op finds a fresh un-releasable lock — a wedged section). Best-effort: a chmod
 *     failure only means the release cannot prove ownership and leaves the lock to
 *     the staleness rule.
 *
 * It NEVER throws for the lock itself — a recording/mint failure is reported as
 * `{ ok:false, because }`, never raised. An `fn` throw DOES propagate, through the
 * release, so the caller's own try/finally still runs.
 */

const fs = require('node:fs');
const path = require('node:path');

const LOCK_WAIT_MS = 2000;        // total wait for a live holder before failing safe
const LOCK_STALE_MS = 10 * 1000;  // the section is two file ops; older than this is debris, broken not waited
const LOCK_SPIN_MS = 20;

/* A bounded pause without a busy-loop where SharedArrayBuffer exists, and a bounded
 * busy-loop where it does not (some sandboxes disable it). `pauseMs` was an
 * unguarded subprocess spawn once, on the synchronous send path, which is the whole
 * reason this stays a plain wait. */
const PARK = new Int32Array(new SharedArrayBuffer(4));
function pauseMs(ms) {
  try { Atomics.wait(PARK, 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { /* no SharedArrayBuffer: bounded spin */ } }
}

const msgOf = (m, dflt) => (typeof m === 'function' ? m() : (m != null ? m : dflt));

/* Run `fn` holding an exclusive lock on `<file>.lock`. Returns { ok:true, value }
 * on success, or { ok:false, because } when the lock cannot be taken.
 *   opts.busy         message when a LIVE holder times out the wait (string or fn)
 *   opts.cannotAccess message when the lock cannot even be attempted (string or fn)
 *   opts.waitMs       wait override; else AGENT_WORKFORCE_LOCK_MS env, else LOCK_WAIT_MS
 */
function withFileLock(file, fn, opts = {}) {
  const lock = file + '.lock';
  let waitMs = opts.waitMs;
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    const env = Number(process.env.AGENT_WORKFORCE_LOCK_MS);
    waitMs = (Number.isFinite(env) && env >= 0) ? env : LOCK_WAIT_MS;
  }
  const until = Date.now() + waitMs;
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (err) {
      // We could not even attempt the lock (an unwritable directory, say).
      // Answering rather than throwing keeps the caller's never-throws contract.
      if (!err || err.code !== 'EEXIST') {
        return { ok: false, because: msgOf(opts.cannotAccess, 'we could not get exclusive access') };
      }
      // The deadline covers this branch too: a leftover non-empty lock dir must
      // not spin the loop forever (measured: a synchronous handler wedged 15s).
      if (Date.now() > until) return { ok: false, because: msgOf(opts.busy, 'the file is locked by another writer') };
      let age = 0;
      // Capture the lock's MTIME alongside its age, from the SAME stat, so the
      // steal below can prove it moved the same dir it measured (kosmos#1991).
      let measuredMtime = null;
      try { const st = fs.statSync(lock); measuredMtime = st.mtimeMs; age = Date.now() - st.mtimeMs; } catch { age = Infinity; }
      if (age > LOCK_STALE_MS) {
        const aside = `${lock}.${process.pid}.${Date.now()}.stale`;
        try { fs.renameSync(lock, aside); }
        catch { pauseMs(LOCK_SPIN_MS); continue; }   // someone else won the steal, or it vanished
        // ⚠️ THE STEAL IS TWO NON-ATOMIC SYSCALLS (kosmos#1991). Between the stat
        // that measured `lock` stale and this rename, another process can have
        // STOLEN the same stale lock AND re-acquired a FRESH LIVE one at the same
        // path. `rename` moves whatever stands at the path NOW, not the dir we
        // measured, so a fresh lock does NOT make it throw -- it succeeds, moving a
        // live holder's lock aside, and without this check we would `rmSync` it and
        // enter the section beside that holder: a lost update, the exact interleave
        // the lock exists to prevent, reached through the path that repairs it.
        // Verify by MTIME that we moved the SAME dir we measured. `rename` preserves
        // mtime, and staleness is itself an mtime bound, so the measured lock's
        // mtime is >LOCK_STALE_MS old while any freshly re-acquired lock's is ~now:
        // the two cannot collide the way a reused inode could. A match means we
        // stole the measured-stale lock; a mismatch (or an mtime we could not read)
        // means a fresh lock was substituted.
        let stolenMtime = null;
        try { stolenMtime = fs.statSync(aside).mtimeMs; } catch { stolenMtime = null; }
        if (measuredMtime == null || stolenMtime == null || stolenMtime !== measuredMtime) {
          // We moved a lock we did not measure stale -- put it back and re-wait,
          // rather than proceed beside its holder. Restoring is what makes the
          // re-wait safe: leaving `lock` empty would let our own next `mkdirSync`
          // acquire it and double-enter anyway. If the path was re-occupied in the
          // meantime the restore throws; the moved dir is then an inert `.stale`
          // leftover the staleness rule collects, and we re-wait regardless.
          try { fs.renameSync(aside, lock); } catch { /* path re-occupied; leave the leftover for the staleness rule */ }
          pauseMs(LOCK_SPIN_MS);
          continue;
        }
        // chmod so the recursive remove can readdir to recurse: a holder that
        // crashed under an owner-bit-clearing umask left the dir un-readable
        // (force suppresses ENOENT, not EACCES). Best-effort; the `.stale` leftover
        // is inert (matched by no reader), this only avoids accumulating it.
        try { fs.chmodSync(aside, 0o700); } catch { /* best-effort */ }
        try { fs.rmSync(aside, { recursive: true, force: true, maxRetries: 5 }); } catch { /* debris, not fatal */ }
        continue;
      }
      pauseMs(LOCK_SPIN_MS);
    }
  }
  const ownerFile = path.join(lock, 'owner');
  try { fs.chmodSync(lock, 0o700); } catch { /* best-effort */ }
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  let marked = false;
  try { fs.writeFileSync(ownerFile, token); fs.chmodSync(ownerFile, 0o600); marked = true; } catch { marked = false; }
  try {
    return { ok: true, value: fn() };
  } finally {
    let ours = marked;
    if (marked) { try { ours = fs.readFileSync(ownerFile, 'utf8') === token; } catch { ours = false; } }
    if (ours) { try { fs.rmSync(lock, { recursive: true, force: true, maxRetries: 5 }); } catch { /* already gone */ } }
  }
}

module.exports = { withFileLock, LOCK_STALE_MS, LOCK_WAIT_MS, LOCK_SPIN_MS };
