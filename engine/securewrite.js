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
 * the instant the bytes land. That is what the arms for this module do.
 *
 * Extracted from `engine/sendertoken.js` after #1776, rather than copied, so
 * there is one implementation and not two to drift. `trust.js` and `create.js`
 * carry older variants of the same pattern and are the precedent for it.
 */

const fs = require('node:fs');

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
function secureDir(dir, mode) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try { fs.chmodSync(dir, mode); } catch { /* best effort, see below */ }
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
    } catch {
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
  } finally {
    /* Close FIRST, then restore: the descriptor above is the one that truncated
       the file. Best effort by design, because whatever brought us here may also
       defeat the restore, and the original error still propagates. */
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } }
    if (!wrote && prior !== null) {
      try {
        fs.writeFileSync(file, prior);
        try { fs.chmodSync(file, mode); } catch { /* best effort */ }
      } catch { /* the restore failed too; the caller still gets the real error */ }
    }
  }
}

module.exports = { writeSecret, secureDir, refuseSymlinkTarget, tempPath };
