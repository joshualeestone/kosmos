'use strict';

/**
 * ONE writer for a file that holds a secret, so the ORDER cannot be got wrong
 * at the next call site.
 *
 * 🛑 THE DEFECT THIS EXISTS TO MAKE UNREACHABLE, measured rather than assumed:
 *
 *     fresh create with mode 0600                  -> 600
 *     pre-existing 644, rewritten with mode 0600   -> 644   <- SILENTLY IGNORED
 *
 * `writeFileSync(..., { mode })` applies the mode ON CREATE ONLY. So the shape
 * `writeFileSync(FILE, secret, { mode: 0o600 })` followed by a chmod puts the
 * secret bytes on disk at the OLD permissions and only tightens them afterwards.
 * Three modules were doing exactly that with plaintext credentials (#1787), and
 * `sendertoken.js` was doing it with agent tokens (#1761).
 *
 * ⭐ AND NO END-STATE ASSERTION CAN CATCH IT, which is why it survived. Both
 * orders end at 0600. #1470 recorded the same thing on the Rust side: a fix that
 * chmodded the destination after every rename also ends correct and PASSES.
 * Catching it needs observation from INSIDE the write, and the fd is the first
 * argument to `fs.writeFileSync`, so a stub can read `fs.fstatSync(fd).mode` at
 * the instant the bytes land. That is what the
 * `tightens BEFORE the bytes land` arm in `engine/securewrite.test.js` does.
 *
 * 📌 THE ARMS FOR THIS MODULE LIVE IN `engine/securewrite.test.js`, DIRECTLY,
 * rather than only reaching it through a consumer. `engine/sendertoken.test.js`
 * also exercises it through `mint()`, and that is useful, but coverage attached to
 * one consumer disappears silently if that consumer stops calling this module,
 * taking the other three callers' guarantees with it.
 *
 * Extracted from `engine/sendertoken.js` after #1776, rather than copied, so
 * there is one implementation and not two to drift.
 *
 * 🛑 CALLERS MUST CATCH. `writeSecret` throws, and on the token-door routes a throw
 * is worse than useless: `server.js` wraps those handlers in `.catch(() => …)` with
 * NO error binding, so a write failure reaches the operator as
 * "we could not read that request" — an unreadable-paste error, on a credential the
 * service just verified. Report it as a refusal in the caller's own shape instead.
 * ⚠️ Pre-existing for ENOSPC and EACCES, WIDENED by this module:
 * `refuseSymlinkTarget` raises ELOOP, a throw source the old in-place writes did not
 * have. Every call site in the tree does this; the reasoning lives here, once. `trust.js` and `create.js`
 * carry older variants of the same pattern and are the precedent for it.
 */

const fs = require('node:fs');

/* ⚠️ A KNOWN RESIDUE, DOCUMENTED RATHER THAN SWEPT, because the sweep is worse.
   A process that dies between the `wx` create and the rename leaves
   `<FILE>.kosmos-<pid>-<started>-<seq>.tmp` behind, holding the secret.

   ⚠️ THE ARGUMENT IS LIFECYCLE, NOT DISCLOSURE, and the disclosure framing is the
   weak half: the temp is 0600, owner-only, exactly the protection the credential
   file sitting legitimately beside it has, so a permissions objection can be waved
   away and the reviewer would be right.

   🛑 THE REAL PROBLEM IS THAT A SECRET OUTLIVES ITS OWN REVOCATION. `forget()`
   unlinks `FILE` and nothing else, so a stale temp holds the OLD token past a
   revoke, past a re-connect, and past an uninstall (`install.uninstall-litter-1547
   .test.js` preserves `secrets/` deliberately), and NO CODE PATH WILL EVER REMOVE
   IT. That is genuinely new for these three modules: the old write-in-place code
   made no second copy. `sendertoken` has carried the identical exposure since #1776.

   📌 Real, and NARROW: it needs death in the window between `writeFileSync(tmp)` and
   `renameSync`. Carded against this module rather than ridden onto the card that
   introduced it, because folding a reaper in here would ship an unreviewed delete
   path alongside a security fix.

   🛑 NOT SWEPT IN `secureDir`, AND THE REASON IS STRONGER THAN "we cannot prove we
   created it". A glob sweep would RECREATE THE DEFECT THIS MODULE EXISTS TO PREVENT.
   `secureDir` acts on the DIRECTORY, and a glob throws away the one thing the temp
   name carries. Two concurrent writers into `secrets/` (the board and a CLI, or two
   provider connects) then race:

       A's secureDir unlinks B's in-flight temp, between B's `wx` create and B's rename
       -> B's renameSync fails ENOENT
       -> B burns all three attempts
       -> B lands in the DESTRUCTIVE in-place fallback

   ⇒ That trades INERT litter for a LIVE path into the exact write this card closed.
   It is also why the unlink below is guarded on `created`, a flag meaning "this call
   made this file" - precisely what a directory sweep can never establish.

   ✅ THE HAZARD IS THE GLOB, NOT THE IDEA. The temp name is self-identifying, so a
   reaper CAN be safe: match the anchored `<file>.kosmos-<pid>-<started>-<seq>.tmp`
   shape and delete only entries whose `pid` is not alive (`process.kill(pid, 0)`
   throwing ESRCH), or whose pid is ours but whose `started` is not this process's.
   That is a checkable predicate rather than a guess. If it lands it belongs HERE,
   once per process, best-effort and never fatal - not on every `secureDir` call.
   Out of scope for this card.

   📌 The unique name makes a leftover inert meanwhile: nothing ever asks for that
   name again, so it is a disclosure question and never a correctness one. */

/* 🔑 pid ALONE IS NOT ENOUGH AND THIS REPO HAS PAID FOR LEARNING IT TWICE.
   `trust.js` documents it at its own `tempPath`: a process that dies between
   create and rename leaves the temp behind, and the next process to draw that
   pid hits `wx` -> EEXIST FOREVER. Measured on #1776: one planted stale temp
   sent every later write down the in-place fallback, permanently, with no
   signal. With the start time and a counter a leftover is inert, because
   nothing ever asks for that name again. */
const STARTED = Date.now();
let SEQ = 0;
const tempPath = (target) => `${target}.kosmos-${process.pid}-${STARTED}-${++SEQ}.tmp`;

/**
 * Refuse to write through a symlink planted at `file`.
 *
 * 🛑 CALL THIS WITH `undefined` AND MEAN IT. Passing a real `O_NOFOLLOW` makes
 * this return immediately, because the kernel enforces the flag at open time
 * instead. That is fine on macOS and it is why deleting the CALL to this
 * function left #1776's suite fully green: on the platform we test, the call did
 * nothing, so no assertion about behaviour could see it. `O_NOFOLLOW` is
 * UNDEFINED on win32, where this hand check is the entire defence.
 *
 * ⚠️ IT HAD ZERO COVERAGE UNTIL IT WAS A FUNCTION, and that is the whole reason it
 * is one. `fs.constants.O_NOFOLLOW` is NON-CONFIGURABLE, so no test can delete it
 * from the environment: the suite stayed fully green with this entire branch
 * removed. A matrix row reading "with the constant forced undefined" describes a
 * MANUAL mutation, not something the suite performs, and crediting it was
 * overclaiming. Extracting it is what let an arm call it directly with `undefined`.
 *
 * 📌 TOCTOU IS ACCEPTED HERE, deliberately: this checks, then the caller opens. The
 * window is narrower than having no check at all, and on win32 creating a symlink
 * needs privilege. `O_NOFOLLOW` on the open is the atomic half where it exists;
 * this is the portable half where it does not.
 */
function refuseSymlinkTarget(file, nofollow) {
  if (nofollow !== undefined) return; // the kernel enforces it via O_NOFOLLOW
  let st = null;
  try { st = fs.lstatSync(file); } catch { return; } // absent: nothing to follow
  if (st.isSymbolicLink()) {
    const e = new Error(`refusing to write a secret through a symlink at ${file}`);
    e.code = 'ELOOP';
    throw e;
  }
}

/**
 * Create `dir` and make sure it is actually at `mode`, not merely asked to be.
 *
 * `mkdirSync`'s mode is create-only too, so a directory that already exists at
 * 0755 stays there. That is #1763, and it matters even when every file inside is
 * 0600: a loose directory discloses the FILENAMES.
 */
/* ⚠️ A SYMLINKED DIRECTORY IS NOT REFUSED HERE, AND THAT IS A DELIBERATE GAP.
   `mkdirSync(dir, { recursive: true })` is a no-op when `dir` is an existing symlink
   to a directory, and `chmodSync` follows it, so the secret is written inside an
   attacker-chosen directory. `writeSecret`'s `lstat` only inspects the FINAL path
   component, so it does not notice.
   ⇒ NOT refused, because a deliberately symlinked store is a plausible real
   deployment (an operator moving `~/Library/Application Support/...` to another
   volume), and refusing would break it with no way to opt back in. Refusing a
   symlinked FILE is safe because nothing legitimately does that; refusing a
   symlinked DIRECTORY is not the same call.
   📌 Pre-existing at all four call sites, and now concentrated in one place, which
   is the argument for fixing it here rather than four times. Carded. */
function secureDir(dir, mode) {
  fs.mkdirSync(dir, { recursive: true, mode });
  /* Best effort on purpose: a directory we cannot chmod is still better than
     refusing the write outright. (Not the same rationale as the chmod on the temp
     below, which is about a restrictive umask clearing the owner bits.) */
  try { fs.chmodSync(dir, mode); } catch { /* see above */ }
}

/**
 * Write `data` to `file` at `mode`, so that `file` is never briefly loose and
 * never partially written.
 *
 * Throws on failure. On the fallback path a failure leaves the previous contents
 * in place where it can, because the alternative is destroying what it failed to
 * replace.
 */
function writeSecret(file, data, mode) {
  /* Up to three attempts at the atomic path before abandoning it. `++SEQ` gives
     a fresh name each time, so the one realistic trigger after the unique-name
     fix, an EEXIST from a PLANTED file, cannot recur on the next name. This is
     what keeps the destructive fallback essentially unreachable rather than
     merely rare. */
  let lastAtomicError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tmp = tempPath(file);
    let created = false;
    try {
      /* `wx` refuses rather than following or reusing anything already at the
         temp path, which also refuses a symlink planted there. */
      fs.writeFileSync(tmp, data, { flag: 'wx', mode });
      created = true;
      /* 🛑 BEST EFFORT, AND IT MUST NOT BE FATAL. A chmod failure here (NFS
         foreign owner, some FUSE and SMB mounts) once discarded the atomic
         path for the in-place fallback and produced the exact defect this
         module exists to prevent, with `ok:true` and no signal. It also buys
         nothing: the temp was created `wx` at `mode`, so it is already at most
         `mode` and this only ever restores owner bits a restrictive umask
         cleared. Measured, four umasks with `flag:'wx', mode:0600`:
         0000 -> 600, 0022 -> 600, 0077 -> 600, and 0600 -> 0. The last case is
         the real job. */
      try { fs.chmodSync(tmp, mode); } catch { /* best effort, see above */ }
      /* rename is atomic, and it REPLACES a symlink at the target rather than
         following it. */
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      /* Keep WHY the atomic path was abandoned, so it is not lost behind the
         fallback's own error when BOTH fail.
         ⚠️ SCOPED HONESTLY, because an earlier version of this comment claimed more
         than the code does: when the fallback SUCCEEDS this reason is still
         discarded, so a persistent EXDEV or EPERM remains invisible to the caller.
         Attaching it there would mean reporting an error on a successful write, which
         is worse. Surfacing it needs a channel this function does not have (a warning
         on the result, or a log line), and that is a caller-shaped change rather than
         a writer-shaped one. Not done here. */
      lastAtomicError = err;
      /* ⚠️ ONLY REMOVE A TEMP WE CREATED. `wx` means a pre-existing file makes
         the write throw, and unlinking then would delete somebody else's file.
         `created` is the FACT; an `err.code !== 'EEXIST'` test is a PROXY for
         it and misses an EEXIST from the chmod or the rename. */
      if (created) { try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ } }
    }
  }

  /* The in-place fallback. It exists so a write that cannot take the atomic path
     fails soft rather than outright, and every line of it is defensive. */
  const NOFOLLOW = fs.constants.O_NOFOLLOW;
  refuseSymlinkTarget(file, undefined);

  /* 🛑 CAPTURE WHAT WE ARE ABOUT TO TRUNCATE. `O_TRUNC` empties the file at
     OPEN, so a write that then fails leaves NOTHING. Measured on #1776 before
     this existed: three live tokens went to zero and a token minted seconds
     earlier stopped resolving. ENOSPC is both the realistic reason that write
     fails AND a realistic reason the atomic path failed, so they are correlated
     rather than independent. */
  let prior = null;
  try { prior = fs.readFileSync(file); } catch { /* absent: nothing to preserve */ }
  let fd = null;
  let wrote = false;
  try {
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT
      | fs.constants.O_TRUNC | (NOFOLLOW || 0), mode);
    /* 🛑 TIGHTEN BEFORE THE BYTES LAND, NOT AFTER. This is the window the whole
       module exists for, and `fchmodSync` on the SAME fd has no TOCTOU, so there
       is no reason to do it second. */
    try { fs.fchmodSync(fd, mode); } catch { /* best effort */ }
    fs.writeFileSync(fd, data);
    wrote = true;
  } catch (err) {
    /* The fallback failed too. Attach why the ATOMIC path was abandoned, so a
       persistent EXDEV or EPERM is not lost behind the fallback's own error. */
    if (lastAtomicError && err && !err.cause) { try { err.cause = lastAtomicError; } catch { /* frozen */ } }
    throw err;
  } finally {
    /* 🛑 GATE THE RESTORE ON `fd`, NOT ON `wrote`. If `openSync` threw, NOTHING was
       truncated and there is nothing to put back, but the old code restored anyway
       through a bare `writeFileSync(file, prior)` with no `O_NOFOLLOW` and no
       `refuseSymlinkTarget`. A symlink planted at `file` between the check above and
       the open, or present on win32 where `NOFOLLOW` is undefined and that check is
       the only defence, would then have made the RECOVERY write the previous secret
       through the link and chmod the victim to 0600.
       ⇒ That is the exact write this module refuses a few lines earlier, reached via
       error handling. `fd !== null` is the fact that the file was really opened and
       really truncated; `wrote` is not. */
    if (fd !== null) {
      /* Restore THROUGH the descriptor, before closing it. `O_NOFOLLOW` already
         proved this fd is not a symlink at open time, so it cannot be redirected;
         a path-based write here could be, by a link swapped in after the close.
         Best effort by design: whatever brought us here may defeat the restore too,
         and the original error still propagates. */
      if (!wrote && prior !== null) {
        try {
          fs.ftruncateSync(fd, 0);
          /* 🛑 PASS THE POSITION EXPLICITLY, AND LOOP. Two separate traps, and the
             first one cost a real regression against `main`:

             1. `fs.writeSync(fd, buf, offset)` takes an offset INTO THE BUFFER. The
                file POSITION argument is the fifth, and omitting it means "current
                position". `ftruncateSync(fd, 0)` does NOT rewind the descriptor
                (POSIX), and `writeFileSync(fd, data)` above may have written some
                bytes before throwing, which ENOSPC mid-write does. Measured: an
                8-byte partial write, then truncate, then `writeSync(fd, prior, 0)`
                lands the secret after EIGHT NUL BYTES. For `sendertoken` that file
                is JSON, so it no longer parses and EVERY live token is lost, which
                is the exact outcome this restore exists to prevent. `main`'s
                path-addressed `writeFileSync(file, prior)` always started at 0.

             2. `writeSync` can SHORT-WRITE and does not retry; `writeFileSync` looped
                internally. On an already-degraded path a short write would silently
                truncate the restored secret, so loop on the return value. */
          let off = 0;
          while (off < prior.length) {
            const n = fs.writeSync(fd, prior, off, prior.length - off, off);
            if (!(n > 0)) break;
            off += n;
          }
        } catch { /* the restore failed too; the caller still gets the real error */ }
      }
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/* `tempPath` is deliberately NOT exported. It has no consumer outside this module,
   and `engine/trust.js` keeps its equivalent private for the same reason: a name
   generator is an implementation detail of the writer, and exporting it invites a
   caller to build a temp path the writer will not clean up. */
module.exports = { writeSecret, secureDir, refuseSymlinkTarget };
