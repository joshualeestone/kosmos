'use strict';
/**
 * Replace a file on Windows while something may be holding it, and never leave
 * a torn one behind.
 *
 * These are the rename-swap primitives the anchor (`engine/win32anchor.js`) uses
 * to keep the fleet's `node.exe` and `engine-path` durable, and that the Windows
 * updater's apply step needs for the same files. They live here so there is ONE
 * copy of each: win32anchor requires them back rather than keeping its own.
 *
 * Node built-ins only, and nothing runs at require. Every function is a plain
 * file operation on paths its caller chose; deciding WHETHER to touch a real
 * anchor is the caller's job.
 */

const fs = require('node:fs');
const path = require('node:path');

/* 🛑 A RUNNING INTERPRETER CANNOT BE OVERWRITTEN ON WINDOWS, BUT IT CAN BE RENAMED.
   The anchored node.exe is the running interpreter of the task board and every
   agent supervisor. Measured on the Windows box (2026-09-11): copying over a
   running node.exe fails with "being used by another process"; renaming it
   succeeds; a new file can then take the old name; the renamed process keeps
   running; and the renamed file can be deleted only once that process exits.
   So a zip that changes the Node version used to fail `ensureAnchored`
   outright, and with it the launcher's hand-off (the person got "port in use"
   until the next logon). The replacement therefore goes BESIDE the old file,
   the old file moves aside, and the new one takes its name. Each process keeps
   the interpreter it started with, and the next start of every task picks up
   the new one.

   Both side names start with the interpreter's own name, so
   `retireLeftoverInterpreters` and a person looking in the folder can tell what
   they are. */
const STAGED_INFIX = '.staged-';
const RETIRED_INFIX = '.retired-';

/* Antivirus and the search indexer routinely hold a handle on a freshly written
   .exe for a moment, and a rename then fails with EPERM, EBUSY or EACCES (the
   reason graceful-fs retries renames on win32). Ten tries 100 ms apart rides that
   out, about a second at worst, without making a real failure slow to report.
   ⚠️ The pause is SYNCHRONOUS (ensureAnchored is called synchronously from agent
   creation inside the board's request handler), so while it waits every other
   board request waits too. Raising either number trades board responsiveness,
   not only reporting speed. */
const RENAME_ATTEMPTS = 10;
const RENAME_RETRY_DELAY_MS = 100;
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/* The sweep leaves a retired interpreter younger than this alone. It may belong
   to another anchoring that moved it aside a moment ago, and that anchoring still
   needs it to move back if its final rename fails. Without retries a swap takes
   milliseconds. Its worst case is three renames (aside, in, back), each
   retried in full. The margin is DERIVED from the retry budget so the two cannot
   drift: twice that worst case, about six seconds. The age is read from the time
   in the name, stamped when the file moves aside, because a rename keeps the
   file's old modification time. */
const SWAP_RENAMES_AT_WORST = 3;
const RETIRED_SWEEP_MIN_AGE_MS = 2 * SWAP_RENAMES_AT_WORST * RENAME_ATTEMPTS * RENAME_RETRY_DELAY_MS;

/* A staged copy younger than this may still be being written by a swap in
   flight: copying 92 MB takes well under a second on a normal disk, but it can
   take far longer on a slow disk or under an antivirus scan. Ten minutes is far
   beyond any real copy and still reclaims a dead swap's 92 MB the same day. */
const STAGED_SWEEP_MIN_AGE_MS = 10 * 60 * 1000;

/* The side name `writeFileAtomic` writes into before it renames over the target.
   Distinct from the interpreter's infixes, so the interpreter sweep never matches
   it. */
const WRITING_INFIX = '.writing-';

/* Makes each temp name unique within a process, on top of the time and pid, so a
   temp a crashed writer left can never be the name a later write asks for. */
let writeSequence = 0;

function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (attempt >= RENAME_ATTEMPTS || !TRANSIENT_RENAME_CODES.has(e && e.code)) throw e;
      pauseSync(RENAME_RETRY_DELAY_MS);
    }
  }
}

/**
 * Put `srcNode` at `nodeAt` even while `nodeAt` is a running interpreter.
 *
 * Throws on failure (ensureAnchored turns that into its sentence). When the swap
 * fails, the retired file is moved back. If even that fails, the thrown message
 * says so, because the fleet's interpreter is then missing from its name and
 * every task start fails until the next anchoring. Between the two renames
 * `nodeAt` does not exist for a moment. A task started in that instant fails to
 * start and runs at the next logon or restart. That window opens only when the
 * Node version changes.
 */
function replaceInterpreter(srcNode, nodeAt, clock) {
  const staged = nodeAt + STAGED_INFIX + clock() + '-' + process.pid;
  let retired = null;
  try {
    /* The copy goes to the side name FIRST, so a failed or half-done copy never
       touches the interpreter the fleet is running on. */
    fs.copyFileSync(srcNode, staged);
    if (fs.existsSync(nodeAt)) {
      /* Stamped AFTER the 92 MB copy, so the sweep's age counts from the moment
         the file moved aside, not from before a slow copy. */
      retired = nodeAt + RETIRED_INFIX + clock() + '-' + process.pid;
      renameWithRetry(nodeAt, retired);
    }
    renameWithRetry(staged, nodeAt);
  } catch (e) {
    if (retired && !fs.existsSync(nodeAt)) {
      try {
        renameWithRetry(retired, nodeAt);
      } catch (restoreError) {
        e.message += ' -- and ' + path.basename(nodeAt) + ' could not be put back from ' + retired +
          ' (' + ((restoreError && restoreError.message) || restoreError) + ')';
      }
    }
    try {
      fs.unlinkSync(staged);
    } catch (unlinkError) {
      /* ENOENT means the copy never created it. Anything else (antivirus holding
         the fresh file) leaves a 92 MB staged copy for the staged sweep: say so. */
      if (!unlinkError || unlinkError.code !== 'ENOENT') {
        e.message += ' -- and the staged copy ' + staged + ' was left behind (' +
          ((unlinkError && unlinkError.message) || unlinkError) + ')';
      }
    }
    throw e;
  }
}

/**
 * Delete the side files earlier swaps of `nodeAt` left beside it. Best-effort and
 * silent by design: a retired node.exe that a supervisor or the board still runs
 * on cannot be deleted until that process exits (measured), and the next
 * anchoring retries. A staged copy exists only while a swap is copying, or after
 * one died or could not delete it, so staged copies get a far longer margin than
 * retired ones.
 *
 * Takes the interpreter's PATH, the same one `replaceInterpreter` builds the side
 * names from, so the names it sweeps and the names a swap writes cannot disagree.
 */
function retireLeftoverInterpreters(nodeAt, clock) {
  const dir = path.dirname(nodeAt);
  const name = path.basename(nodeAt);
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  const now = clock();
  const kinds = [
    [name + RETIRED_INFIX, RETIRED_SWEEP_MIN_AGE_MS],
    [name + STAGED_INFIX, STAGED_SWEEP_MIN_AGE_MS],
  ];
  for (const entry of names) {
    for (const [prefix, minAgeMs] of kinds) {
      if (!entry.startsWith(prefix)) continue;
      const stampedAt = Number(entry.slice(prefix.length).split('-')[0]);
      if (Number.isFinite(stampedAt) && now - stampedAt < minAgeMs) continue;
      try { fs.unlinkSync(path.join(dir, entry)); } catch { /* still in use; the next anchoring retries */ }
    }
  }
}

/**
 * Replace `target` with `data` so that a reader of `target` sees the old bytes or
 * the new bytes, complete, and never an empty or partial file.
 *
 * 🛑 WHY, measured against the file this was written for. `engine-path` is read by
 * every boot shim at logon, and a plain `writeFileSync` truncates it at open and
 * only then writes. A crash, a power cut or a killed process in between left it
 * empty, and the board and every agent then exit 3 at the next logon.
 *
 * The bytes go to a uniquely named temp in the SAME directory (so the rename is
 * never a cross-volume copy), are flushed to disk, and only then does the temp
 * take the target's name, in one rename that replaces the target. The rename
 * retries the transient sharing violations antivirus causes.
 *
 * A crash before the rename leaves the target untouched and the temp behind. That
 * temp is inert: nothing reads it, and its unique name means no later write ever
 * asks for it. It is not swept, because a sweep could take a concurrent writer's
 * temp in flight.
 *
 * Throws on failure, after removing the temp it created. The target then still
 * holds its previous contents.
 */
function writeFileAtomic(target, data) {
  const temp = target + WRITING_INFIX + Date.now() + '-' + process.pid + '-' + (++writeSequence);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  let created = false;
  try {
    /* `wx` refuses anything already at the temp name rather than reusing or
       following it. */
    const fd = fs.openSync(temp, 'wx');
    created = true;
    try {
      let written = 0;
      while (written < bytes.length) {
        const n = fs.writeSync(fd, bytes, written, bytes.length - written, written);
        if (!(n > 0)) throw Object.assign(new Error('short write to ' + temp), { code: 'EIO' });
        written += n;
      }
      /* On disk BEFORE the name moves: otherwise a power cut just after the
         rename could leave the new name on a file whose bytes never landed. */
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetry(temp, target);
  } catch (e) {
    if (created) {
      try {
        fs.unlinkSync(temp);
      } catch (unlinkError) {
        if (!unlinkError || unlinkError.code !== 'ENOENT') {
          e.message += ' -- and the temp ' + temp + ' was left behind (' +
            ((unlinkError && unlinkError.message) || unlinkError) + ')';
        }
      }
    }
    throw e;
  }
}

module.exports = {
  STAGED_INFIX, RETIRED_INFIX, RETIRED_SWEEP_MIN_AGE_MS,
  renameWithRetry, replaceInterpreter, retireLeftoverInterpreters, writeFileAtomic,
};
