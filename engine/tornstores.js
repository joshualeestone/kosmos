'use strict';
/**
 * kosmos#8718: at start-up the board finds the stores a crash left torn, and says so. It changes none of them.
 *
 * What a crash leaves: a file written in place (or renamed into place before its bytes were flushed, #5431) can come
 * back at full length and all zero bytes, or empty. Such a file is unparseable, and many of the board's readers then
 * fail closed. Agent feedback 11-18 described a per-agent state file of zeros, and an earlier one that paused a
 * feature for days while nobody knew why.
 *
 * WHY THIS ONLY REPORTS. Moving a torn store aside, so its reader takes the absent default, was the first design here
 * and it is wrong: across the board, "unreadable reads off" is a deliberate, stated rule, not an accident. Four of
 * them, from their own modules (the first, third and fourth also measured on 11-18: zeroed, moved aside, read again):
 *   - phone-notify-choice.json holds only { off: true }; its existing at all is the person's off (#6488).
 *     Moving it turned phone notices from off back to unset, which the default-on path then turns on.
 *   - heartbeat.json: "an unreadable or corrupt one still falls to off" (Josh, 2026-09-03, engine/heartbeat-setting.js).
 *   - autobalance.json: "a corrupt or unreadable one reads off" (engine/autobalance-setting.js).
 *   - remote.json: an unreadable settings file stays visible until the person repairs it (#4308).
 * A reset can only be decided by the store's owner or the person, so this check never makes it. It makes the torn
 * state VISIBLE instead, which is the half of "silently paused for days" that a start-up check can fix: one board.log
 * line per file and a record the board can show (lastCheck(), and REPORT_DIR/LAST_FILE on disk).
 *
 * Torn means exactly:
 *   - a `.json` that is empty, or all zero bytes
 *   - a `.jsonl` that is all zero bytes (an EMPTY `.jsonl` is an ordinary empty log)
 * A file with real but damaged content is not reported: that is not a crash artifact.
 *
 * Not looked at: a file changed in the last RECENT_MS (a live writer can hold an empty file for a moment), anything
 * that is not a regular file by lstat (so a symlink is never followed), files over MAX_BYTES, anything past MAX_DEPTH,
 * and the top-level folders in SKIP_DIRS.
 *
 * Never throws, and never writes outside REPORT_DIR.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPORT_DIR = 'tornstores';
const LAST_FILE = 'last-check.json';
/* Top-level folders of the data root that are not scanned: this module's own; folders holding files a person
   brought (an attachment or a download may be any JSON at all, empty included, and is theirs, not a store); and
   worlds/, where each other Kosmos keeps its own data root AND its people's project and agent folders
   (engine/worlds.js envOverridesFor), none of which this board's start-up owns. */
const SKIP_DIRS = new Set([REPORT_DIR, 'attachments', 'downloads', 'filepreview', 'bin', 'runtime', 'worlds']);
/* Folders below the data root that are walked. Stores outside attachments sit at most two folders down (measured on
   this fleet's data root, 11-18); three leaves room without reaching deep into anything else kept there. */
const MAX_DEPTH = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 50000;   // a bound on the walk, far above a real data folder (about 2,100 files measured 11-18)
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
 * `secret` is from the path's words alone. opts.now: the clock (tests).
 */
function scan(root, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const out = [];
  let seen = 0;
  const walk = (dir, rel, depth) => {
    if (seen > MAX_ENTRIES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > MAX_ENTRIES) return;
      const r = rel ? rel + '/' + e.name : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth === 0 && SKIP_DIRS.has(e.name)) continue;
        if (depth < MAX_DEPTH) walk(abs, r, depth + 1);
        continue;
      }
      if (!storeKind(e.name)) continue;
      let st;
      try { st = fs.lstatSync(abs); } catch { continue; }
      const shape = tornShape(abs, st, now);
      if (shape) out.push({ rel: r, shape, size: st.size, secret: SECRET_RE.test(r) });
    }
  };
  walk(root, '', 0);
  return out;
}

/* One board.log line for one torn file, in words a person reading the log can act on. */
function logLine(item) {
  const what = item.shape === 'empty' ? 'is empty' : 'is all zero bytes (' + item.size + ')';
  const loud = item.secret ? ' Its name says it may have held a key or token.' : '';
  return 'tornstores: ' + item.rel + ' ' + what + ', most likely from a crash while it was written. Left as it is:'
    + ' whatever reads it treats it as unreadable.' + loud;
}

let LAST = null;

/**
 * Scan `root` and report every torn store: one log line each, and the record at REPORT_DIR/LAST_FILE (removed when
 * nothing is torn, so a stale one never outlives the fix). Answers { at, found: [...] } and keeps it for lastCheck().
 * opts.log: a line writer (console.error by default); opts.now: the clock.
 */
function check(root, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const log = typeof opts.log === 'function' ? opts.log : (line) => console.error(line);
  let found;
  try { found = scan(root, { now }); } catch { found = []; }
  const result = { at: new Date(now).toISOString(), found };
  for (const item of found) { try { log(logLine(item)); } catch { /* a log that cannot write changes nothing */ } }
  const last = path.join(root, REPORT_DIR, LAST_FILE);
  try {
    if (found.length) {
      fs.mkdirSync(path.dirname(last), { recursive: true, mode: 0o700 });
      require('./securewrite').writeSecret(last, JSON.stringify(result, null, 2) + '\n', 0o600, { atomicOnly: true });
    } else {
      fs.rmSync(last, { force: true });
    }
  } catch { /* the log lines already say it */ }
  LAST = result;
  return result;
}

/* What the last check() in this process found, or null before it ran: for the board to show (kosmos#8718 follow-up). */
function lastCheck() { return LAST; }

module.exports = { check, scan, lastCheck, REPORT_DIR, LAST_FILE, SKIP_DIRS, RECENT_MS };
