'use strict';
/**
 * kosmos#8718: a store that a crash left torn is moved aside at start-up, so it reads as absent and takes its default.
 *
 * What a crash leaves: a file written in place (or renamed into place before its bytes were flushed, #5431) can come
 * back at full length and all zero bytes, or empty. Such a file is unparseable, and many of the board's readers fail
 * CLOSED on a store they cannot parse ("unknown, change nothing"), which is right for damaged content and wrong for a
 * crash artifact: the feature stays off until somebody deletes the file by hand. Agent feedback 11-18 described exactly
 * that, a per-agent state file of zeros, and an earlier one that paused a feature for days.
 *
 * So, once, before the board reads its stores, this scans the data folder for:
 *   - a `.json` that is empty, or all zero bytes
 *   - a `.jsonl` that is all zero bytes (an EMPTY `.jsonl` is an ordinary empty log, so it is left alone)
 * and MOVES each one into `torn/<time>/` under the data folder, keeping its path, with one board.log line per file and
 * a `reset.json` in that folder naming them. Nothing is deleted: the bytes are evidence, and a move can be undone.
 *
 * What it deliberately leaves alone, and why:
 *   - a file with real but damaged content. That is not a crash artifact and its owner may need it, so it keeps
 *     failing closed as today. Only the two shapes above are torn.
 *   - a file changed in the last RECENT_MS: a writer that is alive right now (a CLI, an agent's hook) can hold an
 *     empty file for a moment between open and write. A crash's file is older than the restart that follows it.
 *   - symlinks, files over MAX_BYTES, and the folders in SKIP_DIRS (files a person put there, and this module's own).
 *
 * Key and token files are moved like any other (a zeroed key is no key either way), and the log line and the record
 * mark them `secret`, so they can be named louder: their owner regenerates or re-asks for them as it already does
 * for an absent one; nothing here makes a new one.
 *
 * The weakest premise, stated so nobody has to rediscover it: that a store's ABSENT default is safe. One case is not
 * fully: a person turned something off, a crash zeroed that file, and the default turns it back on. The bytes are
 * zeros, so the choice cannot be recovered; the log line and the record name the file so it can be set again.
 *
 * Never throws: a scan that fails leaves every file where it was, and the board starts as it did before this existed.
 */
const fs = require('node:fs');
const path = require('node:path');

const TORN_DIR = 'torn';
/* Top-level folders of the data root that are not scanned: this module's own, and folders holding files a person
   brought (an attachment or a download may be any JSON at all, empty included, and is theirs, not a store). */
const SKIP_DIRS = new Set([TORN_DIR, 'attachments', 'downloads', 'filepreview', 'bin', 'runtime']);
const MAX_DEPTH = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 20000;   // a bound on the walk, far above a real data folder (about 1,000 stores measured 11-18)
const RECENT_MS = 5000;
const CHUNK = 64 * 1024;
const SECRET_RE = /(token|key|secret|cred|signin|password)/i;

function storeKind(name) {
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.jsonl')) return 'jsonl';
  return null;
}

/* True when every byte of the file is zero. Reads in chunks and stops at the first non-zero byte, so an ordinary
   store costs one small read. */
function allZero(file, size) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(CHUNK, size));
    let off = 0;
    while (off < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - off), off);
      if (n <= 0) return false;   // shorter than its stat: something is writing it, so not ours to judge
      for (let i = 0; i < n; i++) if (buf[i] !== 0) return false;
      off += n;
    }
    return true;
  } catch { return false; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/* Whether one file is torn: 'empty', 'zeros', or null. */
function tornShape(file, st, now) {
  const kind = storeKind(path.basename(file));
  if (!kind || !st.isFile()) return null;
  if (now - st.mtimeMs < RECENT_MS) return null;
  if (st.size === 0) return kind === 'json' ? 'empty' : null;
  if (st.size > MAX_BYTES) return null;
  return allZero(file, st.size) ? 'zeros' : null;
}

/**
 * The torn stores under `root`, as [{ rel, shape, size, secret }], `rel` with forward slashes. Reads only.
 * opts.now: the clock (tests).
 */
function scan(root, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const out = [];
  let seen = 0;
  const walk = (dir, rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= MAX_FILES) return;
      const r = rel ? rel + '/' + e.name : e.name;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (depth === 0 && SKIP_DIRS.has(e.name)) continue;
        if (depth < MAX_DEPTH) walk(abs, r, depth + 1);
        continue;
      }
      if (!e.isFile() || !storeKind(e.name)) continue;
      seen++;
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      const shape = tornShape(abs, st, now);
      if (shape) out.push({ rel: r, shape, size: st.size, secret: SECRET_RE.test(r) });
    }
  };
  walk(root, '', 0);
  return out;
}

function stampOf(now) { return new Date(now).toISOString().replace(/[:.]/g, '-'); }

/* One board.log line for one moved file, in words a person reading the log can act on. */
function logLine(item, dest) {
  const what = item.shape === 'empty' ? 'was empty' : 'was all zero bytes (' + item.size + ')';
  const loud = item.secret ? ' It held a key or token: whatever uses it will ask for or make a new one.' : '';
  return 'tornstores: ' + item.rel + ' ' + what + ', most likely from a crash while it was written. Moved to '
    + dest + ' and reset to its default.' + loud;
}

let LAST = null;

/**
 * Scan `root` and move every torn store aside. Answers { at, folder, moved: [...], failed: [...] } (folder null when
 * nothing was torn) and keeps it for lastRun(). opts.log: a line writer (console.error by default); opts.now: clock.
 */
function run(root, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const log = typeof opts.log === 'function' ? opts.log : (line) => console.error(line);
  const result = { at: new Date(now).toISOString(), folder: null, moved: [], failed: [] };
  let found;
  try { found = scan(root, { now }); } catch { found = []; }
  if (found.length) {
    const rel = TORN_DIR + '/' + stampOf(now);
    const folder = path.join(root, ...rel.split('/'));
    for (const item of found) {
      const dest = rel + '/' + item.rel;
      try {
        fs.mkdirSync(path.dirname(path.join(root, ...dest.split('/'))), { recursive: true, mode: 0o700 });
        fs.renameSync(path.join(root, ...item.rel.split('/')), path.join(root, ...dest.split('/')));
        result.moved.push({ ...item, movedTo: dest });
        try { log(logLine(item, dest)); } catch { /* a log that cannot write does not undo the move */ }
      } catch (e) {
        result.failed.push({ ...item, because: (e && e.code) || 'error' });
        try { log('tornstores: ' + item.rel + ' looks torn (' + item.shape + ') but could not be moved aside: ' + ((e && e.code) || 'error') + '. Left where it is.'); } catch { /* as above */ }
      }
    }
    if (result.moved.length) {
      result.folder = rel;
      try {
        const rec = JSON.stringify({ at: result.at, moved: result.moved, failed: result.failed }, null, 2) + '\n';
        require('./securewrite').writeSecret(path.join(folder, 'reset.json'), rec, 0o600, { atomicOnly: true });
      } catch { /* the log lines already say it */ }
    }
  }
  LAST = result;
  return result;
}

/* What the last run() in this process did, or null before it ran. */
function lastRun() { return LAST; }

module.exports = { run, scan, lastRun, TORN_DIR, SKIP_DIRS, RECENT_MS };
