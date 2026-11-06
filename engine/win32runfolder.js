'use strict';
/**
 * kosmos#1765: on Windows, a board serving from a folder outside the person's profile that other accounts on the PC
 * can change says so on the board, once per start.
 *
 * #8108 made Kosmos.exe refuse to start from such a folder, but a copy that ran in place before that keeps starting
 * its board from there through its logon task, and nobody tells the person. This asks that folder's own Kosmos.exe
 * (`--check-run-folder`, tools/windows/KosmosLauncher.cs) rather than keeping a second copy of the rule here, and holds
 * the answer for GET /api/board/run-folder.
 *
 * 🛑 A NOTICE, NOT A STOP. The board keeps serving and the logon task is left alone: stopping either would take a
 * working Kosmos away mid-use with no visible undo, and the fresh copy the notice points to repoints the logon task
 * itself when it is opened.
 *
 * Costs nothing in the normal case: off Windows, for a source checkout (no bundle root), and for a folder inside the
 * profile (where Kosmos installs itself) nothing is started. A check that cannot run says nothing on the board: the
 * notice is a courtesy, and the reason goes to board.log.
 */
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/* A cold Kosmos.exe start under an antivirus scan can be slow; the board is serving meanwhile, so this only bounds
   how long the answer may take to arrive. Measured on the Windows box: about 0.3 s. */
const CHECK_TIMEOUT_MS = 20000;
const FLAG = '--check-run-folder';

let NOTICE = null;   // { folder, message } while this start's answer says the folder is unsafe and it is not dismissed
/* True while this start's question is still out: the board is already serving, so a page can ask before the answer
   arrives, and must be told to ask again rather than told there is nothing (review 1). */
let PENDING = false;

/** Is `child` the same folder as `parent`, or inside it? Windows paths, compared without regard to case. */
function isSameOrInside(child, parent) {
  if (!child || !parent) return false;
  const c = path.win32.resolve(String(child)).replace(/[\\/]+$/, '').toLowerCase();
  const p = path.win32.resolve(String(parent)).replace(/[\\/]+$/, '').toLowerCase();
  return c === p || c.startsWith(p + '\\');
}

function log(o, words) {
  try { (o.log || ((s) => process.stderr.write(s + '\n')))(words); } catch { /* a log line is never fatal */ }
}

/** Reads the launcher's one JSON line. Returns { safe, folder, reason, message } or null when it is not that shape. */
function readAnswer(stdout) {
  let a = null;
  try { a = JSON.parse(String(stdout || '').trim()); } catch { return null; }
  if (!a || typeof a !== 'object' || typeof a.safe !== 'boolean') return null;
  if (a.safe) return { safe: true };
  if (a.checked === false) return { safe: false, checked: false, reason: typeof a.reason === 'string' ? a.reason : '' };
  if (typeof a.message !== 'string' || !a.message || typeof a.folder !== 'string' || !a.folder) return null;
  return { safe: false, folder: a.folder, reason: typeof a.reason === 'string' ? a.reason : '', message: a.message };
}

/**
 * Asks once, at start. Resolves to what it decided ({ asked, notice }); never rejects. Seams: `platform`, `bundleRoot`
 * (a function), `profile`, `exists`, `run` (execFile's shape), `log`.
 */
function atStart(opts) {
  const o = opts || {};
  NOTICE = null;
  PENDING = true;
  return new Promise((resolve) => {
    const done = (asked, notice) => { PENDING = false; resolve({ asked, notice: notice || null }); };
    if ((o.platform || process.platform) !== 'win32') { done(false); return; }
    let root = null;
    try { root = (o.bundleRoot || (() => require('./win32board').bundleRoot()))(); } catch { root = null; }
    if (!root) { done(false); return; }   // a source checkout, or the updater's own work folder
    /* The launcher's own first early return is the same test (UnsafeRunFolderReason: inside the profile is trusted by
       where it is); keep the two alike, or the board would ask about a folder the launcher never reads. */
    const profile = o.profile !== undefined ? o.profile : process.env.USERPROFILE;
    if (profile && isSameOrInside(root, profile)) { done(false); return; }   // where Kosmos installs itself
    const exe = path.win32.join(root, 'Kosmos.exe');
    const exists = o.exists || ((p) => fs.existsSync(p));
    if (!exists(exe)) { log(o, 'Kosmos could not check whether others can change ' + root + ': there is no Kosmos.exe in it.'); done(false); return; }
    const run = o.run || ((file, args, opt, cb) => cp.execFile(file, args, opt, cb));
    try {
      run(exe, [FLAG], { encoding: 'utf8', timeout: CHECK_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }, (err, stdout) => {
        if (err) { log(o, 'Kosmos could not check whether others can change ' + root + ' (' + ((err && err.code) || 'it failed') + ').'); done(true); return; }
        const a = readAnswer(stdout);
        if (!a) { log(o, 'Kosmos could not read the answer about ' + root + ', so the board says nothing about it.'); done(true); return; }
        if (a.safe) { done(true); return; }
        if (a.checked === false) { log(o, 'Kosmos could not finish checking whether others can change ' + root + ' (' + (a.reason || 'it could not read it') + '), so the board says nothing about it.'); done(true); return; }
        NOTICE = { folder: a.folder, message: a.message };
        log(o, 'Kosmos is serving from a folder other people on this computer may be able to change: ' + (a.reason || a.folder) + '.');
        done(true, NOTICE);
      });
    } catch (e) {
      log(o, 'Kosmos could not check whether others can change ' + root + ' (' + ((e && e.message) || 'it failed') + ').');
      done(false);
    }
  });
}

/** The notice for the page, or null. */
function current() { return NOTICE ? { folder: NOTICE.folder, message: NOTICE.message } : null; }
/** True while this start's question is still out. */
function pending() { return PENDING; }
/** Hides it until the next start. */
function dismiss() { NOTICE = null; return true; }

module.exports = { atStart, current, pending, dismiss, readAnswer, isSameOrInside, CHECK_TIMEOUT_MS, FLAG };
